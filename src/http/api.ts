import { Hono } from "hono";
import { z } from "zod";
import { type Engine, renderScenario } from "../core/engine.js";
import { toHar } from "../core/har.js";
import { applyImport, ImportError, importOptionsFrom, parseSpec, planImport, summarize } from "../core/openapi.js";
import type { History } from "../core/history.js";
import { VERSION } from "../version.js";
import { scenarioFromHistory } from "../core/record.js";
import { upstreamUrl } from "../core/rewrite.js";
import { hasAnyTag, ServiceMode, Slug } from "../core/schema.js";
import type { Store } from "../core/store.js";
import { errorStatus } from "./errors.js";

/** JSON management API, mounted at /_mimic/api. */
export function createApi(store: Store, history: History, engine: Engine) {
  const api = new Hono();

  api.onError((err, c) => {
    const status = errorStatus(err);
    const body =
      err instanceof z.ZodError
        ? { error: "Validation failed", issues: err.issues }
        : err instanceof SyntaxError
          ? { error: `Request body must be valid JSON: ${err.message}` }
          : { error: err.message };
    if (status === 500) console.error(err);
    return c.json(body, status);
  });

  api.get("/health", (c) => c.json({ ok: true, readOnly: store.readOnly }));

  // services & scenarios
  /** ?tag=a&tag=b lists services carrying any of the tags (on the service or a scenario). */
  api.get("/services", (c) => {
    const tags = c.req.queries("tag") ?? [];
    const services = store.listServices();
    return c.json(tags.length ? services.filter((s) => hasAnyTag(s, tags)) : services);
  });
  api.get("/tags", (c) => c.json({ tags: store.allTags(), active: store.activeTags }));
  api.post("/services", async (c) => c.json(await store.createService(await c.req.json()), 201));
  api.get("/services/:id", (c) => c.json(store.getService(c.req.param("id"))));
  api.patch("/services/:id", async (c) => c.json(await store.updateService(c.req.param("id"), await c.req.json())));
  api.delete("/services/:id", async (c) => {
    await store.deleteService(c.req.param("id"));
    return c.body(null, 204);
  });
  /** ?path=/x?y=1 → the URL proxy mode would call for that request path, after rewrites. */
  api.get("/services/:id/upstream", (c) => {
    const service = store.getService(c.req.param("id"));
    const path = c.req.query("path") ?? service.path;
    const url = upstreamUrl(service, new URL(path.startsWith("/") ? path : `/${path}`, "http://mimic.local"));
    return url ? c.json({ url: url.toString() }) : c.json({ error: `Service '${service.id}' has no upstream` }, 409);
  });
  api.put("/services/:id/scenarios/:sid", async (c) => {
    const body = await c.req.json();
    return c.json(await store.putScenario(c.req.param("id"), { ...body, id: c.req.param("sid") }));
  });
  /** Body (all optional): { method, path, headers, body } — renders the scenario as it would answer that request. */
  const RenderSample = z
    .object({ method: z.string().optional(), path: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), body: z.string().optional() })
    .strict();
  api.post("/services/:id/scenarios/:sid/render", async (c) => {
    const service = store.getService(c.req.param("id"));
    const scenario = store.getScenario(service.id, c.req.param("sid"));
    const raw = await c.req.text();
    return c.json(renderScenario(service, scenario, RenderSample.parse(raw.trim() ? JSON.parse(raw) : {})));
  });
  api.delete("/services/:id/scenarios/:sid", async (c) => {
    await store.deleteScenario(c.req.param("id"), c.req.param("sid"));
    return c.body(null, 204);
  });

  // profiles
  const withStatus = (profile: ReturnType<Store["getProfile"]>) => ({
    ...profile,
    active: store.isProfileActive(profile),
    problems: store.profileProblems(profile),
  });
  api.get("/profiles", (c) => c.json(store.listProfiles().map(withStatus)));
  /** Body is a profile; with ?from=current, `services` defaults to the current state of every service. */
  api.post("/profiles", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const input = c.req.query("from") === "current" && body.services === undefined ? { ...body, services: store.currentSettings() } : body;
    return c.json(withStatus(await store.putProfile(input, { create: true })), 201);
  });
  api.get("/profiles/:id", (c) => c.json(withStatus(store.getProfile(c.req.param("id")))));
  api.put("/profiles/:id", async (c) => {
    const body = await c.req.json();
    return c.json(withStatus(await store.putProfile({ ...body, id: c.req.param("id") })));
  });
  api.delete("/profiles/:id", async (c) => {
    await store.deleteProfile(c.req.param("id"));
    return c.body(null, 204);
  });
  api.post("/profiles/:id/apply", async (c) => {
    const changed = store.applyProfile(c.req.param("id"));
    return c.json({ applied: c.req.param("id"), changed: changed.map((s) => s.id) });
  });

  // live state (in memory; resets on restart)
  const LivePatch = z
    .object({ mode: ServiceMode.optional(), defaultScenario: Slug.nullable().optional() })
    .strict();
  const liveView = () => {
    const services: Record<string, unknown> = {};
    for (const s of store.listServices()) {
      const def = store.getDefinition(s.id);
      services[s.id] = {
        active: store.isActive(s),
        mode: s.mode,
        defaultScenario: s.defaultScenario ?? null,
        modified: store.isModified(s.id),
        starting: { mode: def.mode, defaultScenario: def.defaultScenario ?? null },
      };
    }
    return { modified: store.modifiedServiceIds(), tags: store.activeTags, services };
  };
  api.get("/state", (c) => c.json(liveView()));
  /** Body: { mode?, defaultScenario? } — null clears the default scenario. */
  api.patch("/state/services/:id", async (c) => {
    const { mode, defaultScenario } = LivePatch.parse(await c.req.json());
    const patch = {
      ...(mode !== undefined && { mode }),
      ...(defaultScenario !== undefined && { defaultScenario: defaultScenario ?? undefined }),
    };
    return c.json(store.setLiveState(c.req.param("id"), patch));
  });
  api.delete("/state/services/:id", (c) => c.json({ reset: store.resetLiveState(c.req.param("id")) }));
  api.delete("/state", (c) => c.json({ reset: store.resetLiveState() }));
  /** Body: { tags: string[] }. Only services with one of the tags answer requests; [] serves all. */
  api.put("/state/tags", async (c) => {
    const { tags } = z.object({ tags: z.array(z.string()) }).strict().parse(await c.req.json());
    store.setActiveTags(tags);
    return c.json({ tags: store.activeTags, active: store.listServices().filter((s) => store.isActive(s)).map((s) => s.id) });
  });
  /** Writes the live state back to the YAML definitions. */
  api.post("/state/save", async (c) => c.json({ saved: await store.saveLiveState() }));

  // OpenAPI import
  /** Body: the spec (JSON or YAML). Query: dryRun, mode, prefix, tags (comma-separated). */
  api.post("/import/openapi", async (c) => {
    try {
      const plan = planImport(parseSpec(await c.req.text()), {
        ...importOptionsFrom({ mode: c.req.query("mode"), prefix: c.req.query("prefix"), tags: c.req.query("tags") }),
        existing: store.listServices().map((s) => ({ id: s.id, method: s.method, path: s.path })),
      });
      if (["1", "true"].includes(c.req.query("dryRun") ?? "")) return c.json({ dryRun: true, ...summarize(plan) });
      const result = await applyImport(store, plan);
      return c.json({ dryRun: false, ...summarize(result) }, result.created.length ? 201 : 200);
    } catch (err) {
      if (err instanceof ImportError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // settings (mimic.yaml)
  const settingsView = () => ({ ...store.getSettings(), problems: store.settingsProblems() });
  api.get("/settings", (c) => c.json(settingsView()));
  /** Body: { errorScenario?: { service, scenario } }. Replaces all settings. */
  api.put("/settings", async (c) => {
    await store.putSettings(await c.req.json());
    return c.json(settingsView());
  });

  // history
  const ValidationFilter = z.enum(["pass", "fail"]).optional();
  const historyFilter = (c: { req: { query(k: string): string | undefined } }) => ({
    serviceId: c.req.query("service"),
    validation: ValidationFilter.parse(c.req.query("validation") || undefined),
  });
  /** ?service=id, ?validation=pass|fail */
  api.get("/history", (c) => c.json(history.list(historyFilter(c))));
  /** Download history as HAR 1.2 (default) or Mimic's JSON; same filters as /history. */
  api.get("/history/export", (c) => {
    const format = z.enum(["har", "json"]).parse(c.req.query("format") ?? "har");
    const entries = history.list(historyFilter(c));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const service = Slug.safeParse(c.req.query("service")).data;
    const name = `mimic-history${service ? `-${service}` : ""}-${stamp}.${format}`;
    c.header("content-disposition", `attachment; filename="${name}"`);
    return c.json(format === "har" ? toHar(entries, VERSION) : entries);
  });
  api.get("/history/:id", (c) => {
    const entry = history.get(c.req.param("id"));
    return entry ? c.json(entry) : c.json({ error: "Not found" }, 404);
  });
  /**
   * Saves a recorded response as a scenario of the service that handled it.
   * Body (all optional): { id, name, service, makeDefault }.
   */
  const FromHistory = z
    .object({ id: Slug.optional(), name: z.string().min(1).optional(), service: Slug.optional(), makeDefault: z.boolean().default(false) })
    .strict();
  api.post("/history/:id/scenario", async (c) => {
    const entry = history.get(c.req.param("id"));
    if (!entry) return c.json({ error: "Not found" }, 404);
    const raw = await c.req.text();
    let body: unknown = {};
    try {
      if (raw.trim()) body = JSON.parse(raw);
    } catch {
      return c.json({ error: "Body must be JSON" }, 400);
    }
    const opts = FromHistory.parse(body);
    const serviceId = opts.service ?? entry.serviceId;
    if (!serviceId) return c.json({ error: "This request matched no service; pass \"service\"" }, 400);
    const draft = scenarioFromHistory(entry, store.getService(serviceId));
    if (draft.blocked) return c.json({ error: draft.warnings[0] }, 409);
    const scenario = await store.putScenario(
      serviceId,
      { ...draft.scenario, ...(opts.id && { id: opts.id }), ...(opts.name && { name: opts.name }) },
      { create: true },
    );
    if (opts.makeDefault) await store.updateService(serviceId, { defaultScenario: scenario.id });
    return c.json({ ...scenario, serviceId, warnings: draft.warnings }, 201);
  });
  /** Sends a recorded request again, through the current live state. Returns the new history entry. */
  api.post("/history/:id/replay", async (c) => {
    const entry = history.get(c.req.param("id"));
    if (!entry) return c.json({ error: "Not found" }, 404);
    const replayed = await engine.replay(entry);
    if (!replayed) return c.json({ error: "The recorded request body was truncated, so it can't be replayed" }, 409);
    return c.json(replayed, 201);
  });
  api.delete("/history", (c) => {
    history.clear();
    return c.body(null, 204);
  });

  api.all("*", (c) => c.json({ error: `Unknown API route ${c.req.method} ${c.req.path}` }, 404));
  return api;
}
