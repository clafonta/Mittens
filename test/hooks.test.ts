import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { History } from "../src/core/history.js";
import { HookError, Hooks, runHook } from "../src/core/hooks.js";
import { FileRepo } from "../src/core/repo.js";
import { Store } from "../src/core/store.js";
import { createApp } from "../src/http/app.js";
import { json } from "./helpers.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

let bump = 0;
/** Writes a hook file with a fresh mtime, so a reload sees a new version. */
async function writeHook(serviceId: string, source: string, name = "hook.js") {
  const file = path.join(dir!, "services", serviceId, name);
  await writeFile(file, source);
  const t = new Date(Date.now() + ++bump * 1000);
  await utimes(file, t, t);
  return file;
}

async function project(hookSource?: string, opts: { fetchImpl?: typeof fetch; enabled?: boolean; name?: string } = {}) {
  dir = await mkdtemp(path.join(tmpdir(), "mimic-hooks-"));
  const store = new Store(new FileRepo(dir));
  await store.load();
  await store.createService({
    id: "users",
    name: "Users",
    path: "/users/{id}",
    defaultScenario: "ok",
    upstream: "https://real.test",
    responseSchema: { "2xx": { type: "object", required: ["id"] } },
    scenarios: [
      { id: "ok", name: "OK", body: '{"id":"x"}', headers: { "content-type": "application/json" } },
      { id: "greet", name: "Greet", template: true, body: '{"id":{{params.id | json}},"hi":true}' },
    ],
  });
  if (hookSource !== undefined) await writeHook("users", hookSource, opts.name);
  const messages: string[] = [];
  const hooks = new Hooks(dir, { enabled: opts.enabled, log: (m) => messages.push(m) });
  await hooks.load(["users"]);
  const history = new History();
  const app = createApp({ store, history, hooks, fetchImpl: opts.fetchImpl });
  const request = (p: string, init?: RequestInit) => app.request(`http://localhost${p}`, init);
  return { store, hooks, history, request, messages, reload: () => hooks.load(["users"]) };
}

describe("request hooks", () => {
  it("can answer directly, with object bodies sent as JSON", async () => {
    const { request, history } = await project(`
      export function request(req) {
        if (!req.headers.authorization) return { status: 401, body: { error: "unauthorized", path: req.path, page: req.query.page } };
      }`);
    const res = await request("/users/7?page=2");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-mimic-source")).toBe("hook");
    expect(await res.json()).toEqual({ error: "unauthorized", path: "/users/7", page: "2" });
    expect(history.list()[0]).toMatchObject({ source: "hook", note: "Answered by hook", serviceId: "users" });

    // Returning nothing carries on as usual.
    const normal = await request("/users/7", { headers: { authorization: "Bearer t" } });
    expect(normal.headers.get("x-mimic-scenario")).toBe("ok");
  });

  it("can pick a scenario (templates still render) and read the JSON body", async () => {
    const { request } = await project(`
      export const request = (req, ctx) => (req.json?.greet ? ctx.scenario("greet") : undefined);`);
    const res = await request("/users/42", { method: "POST", headers: json, body: '{"greet":true}' });
    expect(res.headers.get("x-mimic-scenario")).toBe("greet");
    expect(await res.json()).toEqual({ id: "42", hi: true });
  });

  it("keeps state across requests, which can be cleared", async () => {
    const { request } = await project(`
      export function request(req, ctx) {
        ctx.state.count = (ctx.state.count ?? 0) + 1;
        return { body: { count: ctx.state.count } };
      }`);
    for (const n of [1, 2, 3]) expect(await (await request("/users/1")).json()).toEqual({ count: n });
    expect((await request("/_mimic/api/hooks/state", { method: "DELETE" })).status).toBe(204);
    expect(await (await request("/users/1")).json()).toEqual({ count: 1 });
  });

  it("reports thrown errors, bad return values and unknown scenarios as 500s", async () => {
    const thrower = await project(`export function request() { throw new Error("kaboom"); }`);
    const res = await thrower.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Request hook threw: kaboom");
    expect(res.headers.get("x-mimic-source")).toBe("error");

    await writeHook("users", `export const request = (req, ctx) => ctx.scenario("nope");`);
    await thrower.reload();
    expect(await (await thrower.request("/users/1")).text()).toContain("Hook chose 'nope', which is not a scenario of 'users'");

    await writeHook("users", `export const request = () => 42;`);
    await thrower.reload();
    expect(await (await thrower.request("/users/1")).text()).toContain("Request hook returned number");
  });
});

describe("response hooks", () => {
  it("change proxied responses, and validation sees the result", async () => {
    const fetchImpl = (async () => new Response('{"name":"from upstream"}', { headers: { "content-type": "application/json" } })) as typeof fetch;
    const { request, store, history } = await project(
      `export function response(req, res) {
        const body = JSON.parse(res.body);
        res.headers["x-hooked"] = "yes";
        res.body = JSON.stringify({ ...body, id: req.params.id });
      }`,
      { fetchImpl },
    );
    store.setLiveState("users", { mode: "proxy" });
    const res = await request("/users/9");
    expect(res.headers.get("x-hooked")).toBe("yes");
    expect(await res.json()).toEqual({ name: "from upstream", id: "9" });
    expect(res.headers.get("x-mimic-validation")).toBe("pass");
    expect(history.list()[0]!.note).toContain("changed by response hook");
  });

  it("can return replacement fields", async () => {
    const { request } = await project(`export const response = (req, res) => ({ status: 202, body: { wrapped: JSON.parse(res.body) } });`);
    const res = await request("/users/1");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ wrapped: { id: "x" } });
  });

  it("don't run on Mimic's own errors", async () => {
    const { request, store } = await project(`export const response = () => ({ status: 299 });`);
    await store.updateService("users", { defaultScenario: undefined });
    expect((await request("/users/1")).status).toBe(500);
  });
});

describe("loading", () => {
  it("supports TypeScript hooks and a default export", async () => {
    const { request } = await project(
      `type Req = { params: Record<string, string> };
       export default { request: (req: Req) => ({ body: "ts " + req.params.id }) };`,
      { name: "hook.ts" },
    );
    expect(await (await request("/users/5")).text()).toBe("ts 5");
  });

  it("reloads edits, keeps the last good version on errors, and shows status", async () => {
    const { request, reload, messages, hooks } = await project(`export const request = () => ({ body: "v1" });`);
    expect(await (await request("/users/1")).text()).toBe("v1");

    await writeHook("users", `export const request = () => ({ body: "v2" });`);
    expect(await reload()).toEqual(["users"]);
    expect(await (await request("/users/1")).text()).toBe("v2");

    await writeHook("users", `export const request = ( => {`);
    await reload();
    expect(await (await request("/users/1")).text()).toBe("v2");
    expect(messages.at(-1)).toContain("Couldn't load hook for 'users' (keeping the previous version)");
    const page = await (await request("/_mimic/services/users")).text();
    expect(page).toContain("services/users/hook.js");
    expect(page).toContain("couldn&#39;t load the latest version");
    expect(((await (await request("/_mimic/api/hooks")).json()) as { hooks: { error?: string }[] }).hooks[0]!.error).toContain("hook.js");

    await writeHook("users", `export const nothing = 1;`);
    await reload();
    expect(hooks.error("users")).toContain("exports neither a `request` nor a `response` function");

    await rm(path.join(dir!, "services/users/hook.js"));
    await reload();
    expect(hooks.get("users")).toBeUndefined();
    expect(hooks.error("users")).toBeUndefined();
    expect(await (await request("/users/1")).text()).toBe('{"id":"x"}');
  });

  it("can be turned off", async () => {
    const { request, hooks } = await project(`export const request = () => ({ body: "hooked" });`, { enabled: false });
    expect(hooks.summary()).toEqual([]);
    expect(await (await request("/users/1")).text()).toBe('{"id":"x"}');
  });

  it("times out hooks that never finish", async () => {
    await expect(runHook("Request", () => new Promise(() => {}), 50)).rejects.toThrow(HookError);
    await expect(runHook("Request", () => new Promise(() => {}), 50)).rejects.toThrow("didn't finish within 0.05s");
  });
});
