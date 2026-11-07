import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Engine } from "../core/engine.js";
import { type History, type HistoryEntry, summarizeEntry } from "../core/history.js";
import type { Hooks } from "../core/hooks.js";
import { MatchInput, scoreMatch } from "../core/match.js";
import { applyImport, ImportError, importOptionsFrom, parseSpec, planImport, summarize as summarizeImport } from "../core/openapi.js";
import { compilePath, matchPath } from "../core/path.js";
import { scenarioFromHistory } from "../core/record.js";
import { HttpMethod, MatchRule, ProfileEntry, ServiceMode, Slug } from "../core/schema.js";
import type { Store } from "../core/store.js";
import type { Help } from "../help.js";
import { BASE, SERVICES } from "../http/paths.js";
import { VERSION } from "../version.js";
import type { McpActivity } from "./activity.js";

export interface McpDeps {
  store: Store;
  history: History;
  engine: Engine;
  hooks: Hooks;
  help: Help;
  activity: McpActivity;
}

/** What the assistant is told when it connects. Keep it short: tools carry the details. */
export const INSTRUCTIONS = `Mimic is a local HTTP mock server and recording proxy. The user's app calls Mimic instead of a real backend.

Model:
- A service is a route (method + path template like /api/users/{id}) with a mode: static (always its default scenario), dynamic (the scenario whose match rule fits the request best), or proxy (forward to its upstream URL and record).
- A scenario is a canned response (status, headers, body), optionally with a match rule (params, query, headers, body text, JSONPath) and template: true to fill {{params.id}} etc. from the request.
- Definitions (services, scenarios, profiles) are YAML files the user commits. Live state (each service's current mode and default scenario, the tag filter) is in memory and resets on restart.

How to work:
- Start with get_overview.
- To try something out (switch a mode, make an endpoint fail), change live state with set_live_state or apply_profile; it doesn't touch the user's files. Only call save_live_state if the user wants the change kept.
- To build mocks: create_service, then upsert_scenario. Check your work with send_request, which goes through Mimic like the user's app would and is recorded in History.
- To debug "why did my app get X?": list_requests, then explain_request.
- read_help has the full user documentation.
Mimic's dashboard is at {origin}${BASE}; mention the relevant page when it helps the user see the result.`;

// ------------------------------------------------------------------ helpers

const BODY_LIMIT = 8_000;
const clipBody = (s: string) => (s.length > BODY_LIMIT ? { body: s.slice(0, BODY_LIMIT), bodyClipped: true, bodyLength: s.length } : { body: s });

const json = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const failure = (message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

function errorText(err: unknown): string {
  if (err instanceof z.ZodError) return `Invalid input:\n${z.prettifyError(err)}`;
  return err instanceof Error ? err.message : String(err);
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const LIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const OVERWRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

/** A request body given as text, or as a JSON value (sent as JSON). */
const BodyInput = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]);
const bodyText = (b: z.infer<typeof BodyInput> | undefined) => (b === undefined ? undefined : typeof b === "string" ? b : JSON.stringify(b, null, 2));

// ------------------------------------------------------------------- server

/** A fresh server per request (the endpoint is stateless); tools act on the running Mimic. */
export function createMcpServer(deps: McpDeps, origin: string): McpServer {
  const { store, history, engine, hooks, help, activity } = deps;
  const server = new McpServer({ name: "mimic", title: "Mimic", version: VERSION }, { instructions: INSTRUCTIONS.replace("{origin}", origin) });

  /** Registers a tool whose handler can throw; errors become tool errors, and every call is logged. */
  const tool = <S extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; input: S; annotations: Record<string, boolean> },
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown> | unknown,
  ) => {
    server.registerTool(
      name,
      { title: config.title, description: config.description, inputSchema: config.input, annotations: { title: config.title, ...config.annotations } },
      (async (args: z.infer<z.ZodObject<S>>) => {
        const started = Date.now();
        try {
          const result = await run(args);
          activity.record({ tool: name, args, ok: true, ms: Date.now() - started });
          return json(result);
        } catch (err) {
          const message = errorText(err);
          activity.record({ tool: name, args, ok: false, ms: Date.now() - started, error: message });
          return failure(message);
        }
      }) as never,
    );
  };

  const serviceView = (id: string) => {
    const s = store.getService(id);
    const def = store.getDefinition(id);
    return {
      ...s,
      live: { mode: s.mode, defaultScenario: s.defaultScenario ?? null, delayMs: s.delayMs, modified: store.isModified(id), serving: store.isActive(s) },
      starting: { mode: def.mode, defaultScenario: def.defaultScenario ?? null, delayMs: def.delayMs },
      hook: hooks.get(id)?.exports ?? null,
      dashboard: `${origin}${SERVICES}/${id}`,
    };
  };

  // ------------------------------------------------------------ overview

  tool(
    "get_overview",
    {
      title: "Get overview",
      description:
        "Start here. Lists every service (route, live mode, default scenario, scenario ids, whether its live state differs from its files), profiles, the tag filter, the global error scenario, and request counts. Use get_service for one service's full details.",
      input: {},
      annotations: READ,
    },
    () => {
      const entries = history.list();
      return {
        mimic: { version: VERSION, mockBaseUrl: origin, dashboard: `${origin}${BASE}`, readOnly: store.readOnly },
        services: store.listServices().map((s) => ({
          id: s.id,
          name: s.name,
          route: `${s.method} ${s.path}`,
          mode: s.mode,
          defaultScenario: s.defaultScenario ?? null,
          errorScenario: s.errorScenario ?? null,
          upstream: s.upstream ?? null,
          scenarios: s.scenarios.map((sc) => `${sc.id} (${sc.status}${sc.match ? ", has match rule" : ""})`),
          modified: store.isModified(s.id),
          serving: store.isActive(s),
          tags: s.tags,
        })),
        profiles: store.listProfiles().map((p) => ({ id: p.id, name: p.name, active: store.isProfileActive(p), problems: store.profileProblems(p) })),
        tagFilter: store.activeTags,
        globalErrorScenario: store.getSettings().errorScenario ?? null,
        history: {
          requests: entries.length,
          errors: entries.filter((e) => e.response.status >= 400).length,
          schemaFailures: entries.filter((e) => e.validation && !e.validation.ok).length,
        },
      };
    },
  );

  tool(
    "get_service",
    {
      title: "Get service",
      description: "Everything about one service: its definition, every scenario (status, headers, body, match rule), its live mode and default scenario, and its starting values from the files.",
      input: { id: Slug.describe("Service id") },
      annotations: READ,
    },
    ({ id }) => serviceView(id),
  );

  // ------------------------------------------------------ define mocks

  tool(
    "create_service",
    {
      title: "Create service",
      description:
        "Creates a service (written to the definitions folder). Path templates: {name} captures a segment, a trailing /* matches any suffix. Add scenarios with upsert_scenario afterwards; the first one becomes the default.",
      input: {
        id: Slug.describe("Lowercase letters, digits and dashes; becomes the folder name"),
        name: z.string().min(1).describe("Display name"),
        path: z.string().startsWith("/").describe("Route template, e.g. /api/users/{id}"),
        method: HttpMethod.optional().describe("Default ANY"),
        mode: ServiceMode.optional().describe("Starting mode; default static. proxy needs upstream."),
        upstream: z.string().optional().describe("Real API base URL, for proxy mode"),
        description: z.string().optional(),
        delayMs: z.number().int().min(0).optional(),
        tags: z.array(z.string()).optional(),
        responseSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schemas keyed by status, class or default, e.g. {"2xx": {...}}'),
      },
      annotations: WRITE,
    },
    async (args) => {
      await store.createService(args);
      return { created: serviceView(args.id) };
    },
  );

  tool(
    "update_service",
    {
      title: "Update service",
      description:
        "Changes a service's definition (written to its service.yaml): name, path, method, mode, upstream, stripPrefix, rewrite, delayMs, tags, defaultScenario, errorScenario, responseSchema. Changing mode or defaultScenario here changes the starting state; to switch temporarily use set_live_state instead.",
      input: {
        id: Slug,
        changes: z.record(z.string(), z.unknown()).describe("Fields to change; null or omitted fields are left as they are unless you set them"),
      },
      annotations: OVERWRITE,
    },
    async ({ id, changes }) => {
      const { scenarios: _ignored, id: _id, ...patch } = changes as Record<string, unknown>;
      await store.updateService(id, patch);
      return { updated: serviceView(id) };
    },
  );

  tool(
    "delete_service",
    {
      title: "Delete service",
      description: "Deletes a service and all its scenarios from the definitions folder. Confirm with the user first.",
      input: { id: Slug },
      annotations: DELETE,
    },
    async ({ id }) => {
      await store.deleteService(id);
      return { deleted: id };
    },
  );

  tool(
    "upsert_scenario",
    {
      title: "Create or replace scenario",
      description:
        "Creates or replaces a scenario of a service (written to its YAML file). body may be text or a JSON value; JSON gets content-type application/json unless you set headers. In dynamic mode, 'match' picks this scenario when every criterion fits: {method, params:{id:'404'}, query:{...}, headers:{...}, bodyContains, bodyMatches:{regex,flags}, json:{'$.user.role':'admin'}}; values can also be {regex:'^9\\\\d+$'}. Set template:true to use {{params.id}}, {{query.x}}, {{body.field | json}}, {{uuid}}, {{now}} in the body and headers.",
      input: {
        service: Slug.describe("Service id"),
        id: Slug.describe("Scenario id (file name)"),
        name: z.string().min(1),
        status: z.number().int().min(100).max(599).optional().describe("Default 200"),
        headers: z.record(z.string(), z.string()).optional(),
        body: BodyInput.optional(),
        template: z.boolean().optional(),
        delayMs: z.number().int().min(0).optional(),
        match: MatchRule.optional(),
        tags: z.array(z.string()).optional(),
        makeDefault: z.boolean().optional().describe("Also make it the service's starting default scenario"),
      },
      annotations: OVERWRITE,
    },
    async ({ service, makeDefault, body, headers, ...rest }) => {
      const def = store.getDefinition(service);
      const existed = def.scenarios.some((s) => s.id === rest.id);
      const isJson = body !== undefined && typeof body !== "string";
      const allHeaders = { ...(isJson && { "content-type": "application/json" }), ...headers };
      const scenario = await store.putScenario(service, { ...rest, headers: allHeaders, body: bodyText(body) ?? "" });
      if (makeDefault || !store.getDefinition(service).defaultScenario) await store.updateService(service, { defaultScenario: scenario.id });
      return { [existed ? "replaced" : "created"]: scenario, service: serviceView(service) };
    },
  );

  tool(
    "delete_scenario",
    {
      title: "Delete scenario",
      description: "Deletes one scenario of a service. Confirm with the user first.",
      input: { service: Slug, id: Slug },
      annotations: DELETE,
    },
    async ({ service, id }) => {
      await store.deleteScenario(service, id);
      return { deleted: `${service}/${id}` };
    },
  );

  tool(
    "import_openapi",
    {
      title: "Import OpenAPI",
      description:
        "Creates services from an OpenAPI 3.0/3.1 spec (pass its text, or a URL): one service per operation, scenarios from examples or generated from schemas, response schemas for validation. Existing services are skipped. Use dryRun first to show the user what would be created.",
      input: {
        spec: z.string().optional().describe("The spec as YAML or JSON text"),
        url: z.string().url().optional().describe("Or a URL to fetch it from"),
        mode: ServiceMode.optional(),
        prefix: z.string().optional().describe("Route prefix instead of the spec's server path"),
        tags: z.array(z.string()).optional(),
        dryRun: z.boolean().optional(),
      },
      annotations: { ...WRITE, openWorldHint: true },
    },
    async ({ spec, url, mode, prefix, tags, dryRun }) => {
      let text = spec;
      if (!text && url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Couldn't fetch ${url}: HTTP ${res.status}`);
        text = await res.text();
      }
      if (!text) throw new Error("Pass the spec text or a url");
      try {
        const plan = planImport(parseSpec(text), {
          ...importOptionsFrom({ mode, prefix, tags: tags?.join(",") }),
          existing: store.listServices().map((s) => ({ id: s.id, method: s.method, path: s.path })),
        });
        if (dryRun) return { dryRun: true, ...summarizeImport(plan) };
        return { dryRun: false, ...summarizeImport(await applyImport(store, plan)) };
      } catch (err) {
        if (err instanceof ImportError) throw new Error(err.message);
        throw err;
      }
    },
  );

  // -------------------------------------------------------- live state

  tool(
    "set_live_state",
    {
      title: "Switch mode or default scenario (live)",
      description:
        "Changes what a service does right now, without touching the files (resets on restart): its mode, default scenario and/or delay. Use this to try things, e.g. make an endpoint return its error scenario, or slow it down to test loading states.",
      input: {
        service: Slug,
        mode: ServiceMode.optional(),
        defaultScenario: Slug.nullable().optional().describe("null clears it"),
        delayMs: z.number().int().min(0).optional().describe("Service-level delay in ms (scenario delays still win)"),
      },
      annotations: LIVE,
    },
    ({ service, mode, defaultScenario, delayMs }) => {
      store.setLiveState(service, {
        ...(mode !== undefined && { mode }),
        ...(defaultScenario !== undefined && { defaultScenario: defaultScenario ?? undefined }),
        ...(delayMs !== undefined && { delayMs }),
      });
      return { live: serviceView(service).live };
    },
  );

  tool(
    "reset_live_state",
    {
      title: "Reset live state",
      description: "Puts one service (or every service, if no id) back to the mode and default scenario in its files.",
      input: { service: Slug.optional() },
      annotations: LIVE,
    },
    ({ service }) => ({ reset: store.resetLiveState(service) }),
  );

  tool(
    "save_live_state",
    {
      title: "Save live state to files",
      description: "Writes every service's current live mode and default scenario into its YAML, so Mimic starts that way next time. Only when the user wants the change kept.",
      input: {},
      annotations: OVERWRITE,
    },
    async () => ({ saved: await store.saveLiveState() }),
  );

  tool(
    "apply_profile",
    {
      title: "Apply profile",
      description: "Applies a profile (a named set of modes and default scenarios, e.g. 'outage') to the live state. Doesn't change files.",
      input: { id: Slug },
      annotations: LIVE,
    },
    ({ id }) => ({ applied: id, changed: store.applyProfile(id).map((s) => s.id) }),
  );

  tool(
    "save_profile",
    {
      title: "Create or replace profile",
      description:
        "Saves a profile (written to profiles/<id>.yaml). Without 'services' it captures the current live state of every service, which is the easy way to save 'what I have now'.",
      input: {
        id: Slug,
        name: z.string().min(1),
        description: z.string().optional(),
        services: z.record(Slug, ProfileEntry).optional().describe('e.g. {"users": {"mode": "static", "scenario": "server-error"}, "orders": {"delayMs": 1500}}'),
      },
      annotations: OVERWRITE,
    },
    async ({ id, name, description, services }) => {
      const profile = await store.putProfile({ id, name, description: description ?? "", services: services ?? store.currentSettings() });
      return { saved: profile };
    },
  );

  // ----------------------------------------------------------- traffic

  tool(
    "list_requests",
    {
      title: "List recent requests",
      description: "Recent requests Mimic handled, newest first: method, path, status, which service and scenario answered, and why (source). Use get_request or explain_request for one.",
      input: {
        service: Slug.optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 20"),
        errorsOnly: z.boolean().optional().describe("Only status >= 400"),
        schemaFailuresOnly: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ service, limit = 20, errorsOnly, schemaFailuresOnly }) => {
      let entries = history.list({ serviceId: service, ...(schemaFailuresOnly && { validation: "fail" as const }) });
      if (errorsOnly) entries = entries.filter((e) => e.response.status >= 400);
      return { total: entries.length, requests: entries.slice(0, limit).map(summarizeEntry) };
    },
  );

  const fullEntry = (e: HistoryEntry) => ({
    ...e,
    request: { ...e.request, ...clipBody(e.request.body) },
    response: { ...e.response, ...clipBody(e.response.body) },
    dashboard: `${origin}${BASE}/history/${e.id}`,
  });
  const entryOrThrow = (id: string) => {
    const e = history.get(id);
    if (!e) throw new Error(`No request '${id}' in history (it keeps the latest ${history.limit})`);
    return e;
  };

  tool(
    "get_request",
    {
      title: "Get request",
      description: "One request from history with full headers and bodies (long bodies are clipped).",
      input: { id: z.string() },
      annotations: READ,
    },
    ({ id }) => fullEntry(entryOrThrow(id)),
  );

  tool(
    "explain_request",
    {
      title: "Explain request",
      description:
        "Explains why a request got the response it did: which service matched (or why none did), the mode, and for dynamic services how each scenario's match rule compares with the request today. Use it to debug 'why did my app get X?'.",
      input: { id: z.string() },
      annotations: READ,
    },
    ({ id }) => explain(entryOrThrow(id)),
  );

  function explain(e: HistoryEntry) {
    const req = { method: e.request.method, path: e.request.path, url: e.request.url };
    const outcome = { status: e.response.status, source: e.source, service: e.serviceId ?? null, scenario: e.scenarioId ?? null, note: e.note ?? null, validation: e.validation ?? null };
    if (!e.serviceId) {
      const samePath = store
        .listServices()
        .filter((s) => matchPath(compilePath(s.path), e.request.path))
        .map((s) => ({ id: s.id, route: `${s.method} ${s.path}`, serving: store.isActive(s) }));
      return {
        request: req,
        outcome,
        why: samePath.length
          ? "Services match this path but not this request (method differs, or they're outside the tag filter)."
          : "No service's path matches this request.",
        servicesWithMatchingPath: samePath,
        tagFilter: store.activeTags,
      };
    }
    let service;
    try {
      service = store.getService(e.serviceId);
    } catch {
      return { request: req, outcome, why: "The service that answered has since been deleted." };
    }
    const params = matchPath(compilePath(service.path), e.request.path) ?? {};
    const input = new MatchInput(e.request.method, new URL(e.request.url), new Headers(e.request.headers), params, e.request.body);
    const candidates =
      service.mode === "dynamic"
        ? service.scenarios.map((sc) => {
            const score = scoreMatch(sc.match, input);
            return { scenario: sc.id, hasMatchRule: !!sc.match, matchesNow: score !== null, criteriaMatched: score === null ? 0 : Math.floor(score / 1000), match: sc.match ?? null };
          })
        : undefined;
    const why =
      e.source === "proxy"
        ? "The service was in proxy mode, so the real API answered."
        : e.source === "hook"
          ? "The service's request hook answered."
          : e.source === "fallback"
            ? `No match rule fitted, so the fallback was used${e.note ? ` (${e.note})` : ""}.`
            : e.source === "error"
              ? `Mimic couldn't answer: ${e.note ?? "see note"}.`
              : service.mode === "static"
                ? "Static mode always sends the default scenario."
                : "This scenario's match rule fitted best.";
    return {
      request: { ...req, params },
      outcome,
      why,
      service: { id: service.id, route: `${service.method} ${service.path}`, modeNow: service.mode, defaultScenarioNow: service.defaultScenario ?? null },
      ...(candidates && { scenariosNow: candidates }),
      note: "Modes and scenarios shown are as they are now; they may have changed since the request.",
    };
  }

  tool(
    "send_request",
    {
      title: "Send test request",
      description:
        "Sends a request through Mimic exactly as the user's app would, and returns what came back (status, which service and scenario answered, headers, body). Use it to check a configuration works. It's recorded in History. In proxy mode it reaches the real API.",
      input: {
        method: HttpMethod.exclude(["ANY"]).optional().describe("Default GET"),
        path: z.string().startsWith("/").describe("Path and query, e.g. /api/users/7?verbose=true"),
        headers: z.record(z.string(), z.string()).optional(),
        body: BodyInput.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ method = "GET", path, headers, body }) => {
      const text = bodyText(body) ?? "";
      const h = new Headers(headers);
      if (body !== undefined && typeof body !== "string" && !h.has("content-type")) h.set("content-type", "application/json");
      const res = await engine.handle({ method, url: new URL(path, origin), headers: h, body: new TextEncoder().encode(text) });
      return {
        status: res.status,
        answeredBy: { service: res.service?.id ?? null, scenario: res.scenario?.id ?? null, source: res.source, note: res.note ?? null },
        validation: res.validation ?? null,
        headers: res.headers,
        ...clipBody(new TextDecoder().decode(res.body)),
        historyId: res.entry.id,
      };
    },
  );

  tool(
    "replay_request",
    {
      title: "Replay request",
      description: "Sends a recorded request again through the current live state, and says whether the response matches the original.",
      input: { id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      const original = entryOrThrow(id);
      const replayed = await engine.replay(original);
      if (!replayed) throw new Error("The recorded request body was truncated, so it can't be replayed.");
      return {
        replayId: replayed.id,
        status: replayed.response.status,
        sameAsOriginal: replayed.response.status === original.response.status && replayed.response.body === original.response.body,
        was: { status: original.response.status, scenario: original.scenarioId ?? null },
        now: { status: replayed.response.status, scenario: replayed.scenarioId ?? null, source: replayed.source },
      };
    },
  );

  tool(
    "save_request_as_scenario",
    {
      title: "Save recorded response as scenario",
      description:
        "Turns a recorded response (e.g. from proxy mode) into a scenario of the service that handled it, with a match rule built from the request's path params and query.",
      input: {
        id: z.string().describe("History id"),
        scenarioId: Slug.optional(),
        name: z.string().optional(),
        service: Slug.optional().describe("Defaults to the service that handled it"),
        makeDefault: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    async ({ id, scenarioId, name, service, makeDefault }) => {
      const entry = entryOrThrow(id);
      const serviceId = service ?? entry.serviceId;
      if (!serviceId) throw new Error("No service handled this request; pass 'service'.");
      const draft = scenarioFromHistory(entry, store.getService(serviceId));
      if (draft.blocked) throw new Error(draft.warnings[0]);
      const scenario = await store.putScenario(
        serviceId,
        { ...draft.scenario, ...(scenarioId && { id: scenarioId }), ...(name && { name }) },
        { create: true },
      );
      if (makeDefault) await store.updateService(serviceId, { defaultScenario: scenario.id });
      return { created: scenario, service: serviceId, warnings: draft.warnings };
    },
  );

  // -------------------------------------------------------------- help

  tool(
    "read_help",
    {
      title: "Read Mimic help",
      description: "Mimic's user documentation. No arguments: the list of topics. topic: that topic's full text (Markdown). search: matching sections.",
      input: { topic: z.string().optional(), search: z.string().optional() },
      annotations: READ,
    },
    ({ topic, search }) => {
      if (search) return { results: help.search(search, 10).map((r) => ({ topic: r.slug, section: r.heading, anchor: r.id, excerpt: r.snippet.replace(/<\/?mark>/g, "") })) };
      if (topic !== undefined) {
        const t = help.get(topic === "overview" ? "" : topic);
        if (!t) throw new Error(`No topic '${topic}'. Topics: ${help.topics.map((x) => x.slug).join(", ")}`);
        return { topic: t.slug || "overview", title: t.title, markdown: t.markdown };
      }
      return { topics: [{ topic: "overview", title: help.home.title }, ...help.topics.map((t) => ({ topic: t.slug, title: t.title, sections: t.headings.filter((h) => h.depth === 2).map((h) => h.text) }))] };
    },
  );

  return server;
}
