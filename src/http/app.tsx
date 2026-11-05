import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { Engine } from "../core/engine.js";
import { History } from "../core/history.js";
import { ServiceMode } from "../core/schema.js";
import { ConflictError, NotFoundError, Store } from "../core/store.js";
import { Layout } from "../ui/layout.js";
import { HistoryEntryPage, HistoryPage, HistoryTable, NotFoundPage, ServicePage, ServiceRow, ServicesPage } from "../ui/pages.js";
import { BASE } from "./paths.js";

export interface AppDeps {
  store: Store;
  history: History;
  fetchImpl?: typeof fetch;
}

const htmxSource = readFileSync(createRequire(import.meta.url).resolve("htmx.org/dist/htmx.min.js"), "utf8");
const NO_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function corsHeaders(req: Request): Record<string, string> {
  return {
    "access-control-allow-origin": req.headers.get("origin") ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    "access-control-allow-headers": req.headers.get("access-control-request-headers") ?? "*",
    "access-control-expose-headers": "*",
    vary: "Origin",
  };
}

function errorStatus(err: unknown): 400 | 404 | 409 | 500 {
  if (err instanceof z.ZodError) return 400;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  return 500;
}

export function createApp({ store, history, fetchImpl }: AppDeps) {
  const engine = new Engine(store, history, fetchImpl);
  const app = new Hono();

  // ---------------------------------------------------------------- JSON API
  const api = new Hono();
  api.onError((err, c) => {
    const status = errorStatus(err);
    const body = err instanceof z.ZodError ? { error: "Validation failed", issues: err.issues } : { error: err.message };
    if (status === 500) console.error(err);
    return c.json(body, status);
  });

  api.get("/health", (c) => c.json({ ok: true, readOnly: store.readOnly }));
  api.get("/services", (c) => c.json(store.listServices()));
  api.post("/services", async (c) => c.json(await store.createService(await c.req.json()), 201));
  api.get("/services/:id", (c) => c.json(store.getService(c.req.param("id"))));
  api.patch("/services/:id", async (c) => c.json(await store.updateService(c.req.param("id"), await c.req.json())));
  api.delete("/services/:id", async (c) => {
    await store.deleteService(c.req.param("id"));
    return c.body(null, 204);
  });
  api.put("/services/:id/scenarios/:sid", async (c) => {
    const body = await c.req.json();
    return c.json(await store.putScenario(c.req.param("id"), { ...body, id: c.req.param("sid") }));
  });
  api.delete("/services/:id/scenarios/:sid", async (c) => {
    await store.deleteScenario(c.req.param("id"), c.req.param("sid"));
    return c.body(null, 204);
  });
  api.get("/history", (c) => c.json(history.list({ serviceId: c.req.query("service") })));
  api.get("/history/:id", (c) => {
    const entry = history.get(c.req.param("id"));
    return entry ? c.json(entry) : c.json({ error: "Not found" }, 404);
  });
  api.delete("/history", (c) => {
    history.clear();
    return c.body(null, 204);
  });
  api.all("*", (c) => c.json({ error: `Unknown API route ${c.req.method} ${c.req.path}` }, 404));

  // ---------------------------------------------------------------- HTML UI
  const ui = new Hono();
  const page = (c: Context, title: string, body: unknown, status: 200 | 404 = 200) =>
    c.html(
      <Layout title={title} readOnly={store.readOnly}>
        {body as never}
      </Layout>,
      status,
    );

  ui.onError((err, c) => {
    const status = errorStatus(err);
    if (status === 500) console.error(err);
    if (c.req.header("hx-request")) return c.text(err.message, status);
    return page(c, "Error", <NotFoundPage message={err.message} />, 404);
  });

  ui.get("/assets/htmx.min.js", (c) => {
    c.header("content-type", "text/javascript; charset=utf-8");
    c.header("cache-control", "public, max-age=86400");
    return c.body(htmxSource);
  });
  ui.get("/", (c) => page(c, "Services", <ServicesPage services={store.listServices()} />));
  ui.get("/services/:id", (c) => {
    const service = store.getService(c.req.param("id"));
    return page(c, service.name, <ServicePage service={service} />);
  });
  ui.get("/history", (c) => page(c, "History", <HistoryPage />));
  ui.get("/history/:id", (c) => {
    const entry = history.get(c.req.param("id"));
    if (!entry) return page(c, "Not found", <NotFoundPage message="That request is no longer in history." />, 404);
    return page(c, "Request", <HistoryEntryPage entry={entry} />);
  });

  // htmx fragments
  ui.get("/ui/history", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 500);
    const entries = history.list({ serviceId: c.req.query("service") }).slice(0, limit);
    return c.html(<HistoryTable entries={entries} />);
  });
  ui.post("/ui/services/:id", async (c) => {
    const form = await c.req.parseBody();
    const patch = {
      mode: ServiceMode.parse(form.mode),
      defaultScenario: typeof form.defaultScenario === "string" && form.defaultScenario ? form.defaultScenario : undefined,
    };
    const service = await store.updateService(c.req.param("id"), patch);
    return c.html(<ServiceRow service={service} />);
  });

  app.route(`${BASE}/api`, api);
  app.route(BASE, ui);
  app.all(`${BASE}/*`, (c) => page(c, "Not found", <NotFoundPage message={`No page at ${c.req.path}`} />, 404));

  // ---------------------------------------------------------------- mock traffic
  app.all("*", async (c) => {
    const req = c.req.raw;
    // Answer CORS preflights so browser apps can call mocks from another origin.
    if (req.method === "OPTIONS" && req.headers.has("access-control-request-method")) {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    const res = await engine.handle({
      method: req.method,
      url: new URL(req.url),
      headers: req.headers,
      body: new Uint8Array(await req.arrayBuffer()),
    });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(req))) if (!headers.has(k)) headers.set(k, v);
    headers.set("x-mimic-source", res.source);
    if (res.service) headers.set("x-mimic-service", res.service.id);
    if (res.scenario) headers.set("x-mimic-scenario", res.scenario.id);
    const noBody = NO_BODY_STATUS.has(res.status) || req.method === "HEAD";
    return new Response(noBody ? null : res.body, { status: res.status, headers });
  });

  return app;
}
