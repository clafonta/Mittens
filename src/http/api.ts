import { Hono } from "hono";
import { z } from "zod";
import type { History } from "../core/history.js";
import type { Store } from "../core/store.js";
import { errorStatus } from "./errors.js";

/** JSON management API, mounted at /_mimic/api. */
export function createApi(store: Store, history: History) {
  const api = new Hono();

  api.onError((err, c) => {
    const status = errorStatus(err);
    const body = err instanceof z.ZodError ? { error: "Validation failed", issues: err.issues } : { error: err.message };
    if (status === 500) console.error(err);
    return c.json(body, status);
  });

  api.get("/health", (c) => c.json({ ok: true, readOnly: store.readOnly }));

  // services & scenarios
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
    const changed = await store.applyProfile(c.req.param("id"));
    return c.json({ applied: c.req.param("id"), changed: changed.map((s) => s.id) });
  });

  // history
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
  return api;
}
