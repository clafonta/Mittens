import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { History } from "../src/core/history.js";
import { Hooks } from "../src/core/hooks.js";
import { FileRepo } from "../src/core/repo.js";
import { Store } from "../src/core/store.js";
import { watchDefinitions, type DefinitionsWatcher } from "../src/core/watch.js";
import { createApp } from "../src/http/app.js";
import { fixtures, form, json, setup } from "./helpers.js";

let dir: string | undefined;
let watcher: DefinitionsWatcher | undefined;
afterEach(async () => {
  watcher?.close();
  watcher = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("profiles can set delays", () => {
  const slow = { id: "slow", name: "Slow network", description: "", services: { users: { delayMs: 150 } } };

  it("applying one slows the service down; it shows as active and resets", async () => {
    const { request, store } = await setup(fixtures(), undefined, [slow]);
    store.applyProfile("slow");
    expect(store.getService("users").delayMs).toBe(150);
    expect(store.getDefinition("users").delayMs).toBe(0);
    expect(store.isModified("users")).toBe(true);
    expect(store.isChoiceModified("users")).toBe(false); // only the delay changed
    expect(store.isProfileActive(store.getProfile("slow"))).toBe(true);
    const started = Date.now();
    await request("/users/1");
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    store.resetLiveState();
    expect(store.getService("users").delayMs).toBe(0);
  });

  it("the live-state API and 'new profile from current' include delays", async () => {
    const { request, store } = await setup(fixtures());
    const res = await request("/_mittens/api/state/services/users", { method: "PATCH", headers: json, body: JSON.stringify({ delayMs: 300 }) });
    expect(((await res.json()) as { delayMs: number }).delayMs).toBe(300);
    expect(store.currentSettings().users).toMatchObject({ delayMs: 300 });
    expect(store.currentSettings().orders).not.toHaveProperty("delayMs");
    const state = (await (await request("/_mittens/api/state")).json()) as { services: Record<string, { delayMs: number; starting: { delayMs: number } }> };
    expect(state.services.users).toMatchObject({ delayMs: 300, starting: { delayMs: 0 } });
    expect(await (await request("/_mittens/services")).text()).toContain("⏱ 300 ms");
  });

  it("the profile form has a delay per service", async () => {
    const { request, store } = await setup(fixtures());
    const res = await request(
      "/_mittens/profiles",
      form({ id: "slow", name: "Slow", "svc.users.include": "on", "svc.users.delayMs": "1500", "svc.orders.include": "on", "svc.orders.delayMs": "" }),
    );
    expect(res.status).toBe(303);
    expect(store.getProfile("slow").services).toEqual({ users: { delayMs: 1500 }, orders: {} });
    expect(await (await request("/_mittens/profiles/slow/edit")).text()).toContain('name="svc.users.delayMs" value="1500"');
    expect(await (await request("/_mittens/profiles")).text()).toContain("1500 ms");
    const bad = await request("/_mittens/profiles", form({ id: "bad", name: "Bad", "svc.users.include": "on", "svc.users.delayMs": "soon" }));
    expect(bad.status).toBe(422);
  });
});

describe("hooks: shared state and the live state", () => {
  async function project(hooks: Record<string, string>) {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-shared-"));
    const store = new Store(new FileRepo(dir));
    await store.load();
    for (const id of Object.keys(hooks)) {
      await store.createService({ id, name: id, path: `/${id}`, defaultScenario: "ok", scenarios: [{ id: "ok", name: "OK", body: "scenario" }, { id: "alt", name: "Alt", body: "alt" }] });
      await writeFile(path.join(dir, "services", id, "hook.js"), hooks[id]!);
    }
    const h = new Hooks(dir);
    await h.load(Object.keys(hooks));
    const app = createApp({ store, history: new History(), hooks: h });
    return { store, request: async (p: string, i?: RequestInit) => (await app.request(`http://localhost${p}`, i)).text() };
  }

  it("ctx.shared is one object across services, cleared with the hook state", async () => {
    const { request } = await project({
      add: `export const request = (req, ctx) => { (ctx.shared.items ??= []).push("x"); return { body: "added" }; };`,
      count: `export const request = (req, ctx) => ({ body: String(ctx.shared.items?.length ?? 0) });`,
    });
    await request("/add");
    await request("/add");
    expect(await request("/count")).toBe("2");
    await request("/_mittens/api/hooks/state", { method: "DELETE" });
    expect(await request("/count")).toBe("0");
  });

  it("ctx.live.modified lets a hook step aside for a profile's choice", async () => {
    const { request, store } = await project({
      list: `export const request = (req, ctx) => (ctx.live.modified ? undefined : { body: "from hook" });`,
    });
    expect(await request("/list")).toBe("from hook");
    store.setLiveState("list", { defaultScenario: "alt" });
    expect(await request("/list")).toBe("alt");
    store.setLiveState("list", { defaultScenario: "ok", delayMs: 10 });
    expect(await request("/list")).toBe("from hook"); // a delay alone doesn't count as a choice
  });

  it("warns that files hooks import need a restart", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-imports-"));
    const store = new Store(new FileRepo(dir));
    await store.load();
    const logs: string[] = [];
    watcher = watchDefinitions(dir, store, { debounceMs: 30, log: (m) => logs.push(m) });
    await new Promise((r) => setTimeout(r, 250));
    await mkdir(path.join(dir, "shop"), { recursive: true });
    await writeFile(path.join(dir, "shop", "state.ts"), "export const x = 1;\n");
    const start = Date.now();
    while (!logs.some((l) => l.includes("shop/state.ts")) && Date.now() - start < 4000) await new Promise((r) => setTimeout(r, 20));
    expect(logs.find((l) => l.includes("shop/state.ts"))).toContain("Restart Mittens to pick it up");
    void utimes;
  });
});

describe("/_mittens is for this computer only", () => {
  const post = (origin?: string, extra: Record<string, string> = {}) => ({
    ...form({}),
    headers: { "content-type": "application/x-www-form-urlencoded", ...(origin && { origin }), ...extra },
  });

  it("refuses cross-site changes, e.g. a form on another website deleting a service", async () => {
    const { request, store } = await setup(fixtures());
    const res = await request("/_mittens/services/orders/delete", post("https://evil.example"));
    expect(res.status).toBe(403);
    expect(store.listServices().map((s) => s.id)).toContain("orders");
    expect((await request("/_mittens/api/profiles", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
    expect((await request("/_mittens/api/state", { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await request("/_mittens/services/orders/delete", post("null"))).status).toBe(403);
  });

  it("allows the dashboard itself, local dev tools and scripts", async () => {
    const { request } = await setup(fixtures());
    expect((await request("/_mittens/ui/services/users", post("http://localhost", { "content-type": "application/x-www-form-urlencoded" }))).status).not.toBe(403);
    expect((await request("/_mittens/api/state", { method: "DELETE", headers: { origin: "http://localhost:5173" } })).status).toBe(200);
    expect((await request("/_mittens/api/state", { method: "DELETE" })).status).toBe(200); // curl, no Origin
    expect((await request("/_mittens/api/state", { method: "DELETE", headers: { origin: "http://127.0.0.1:3000" } })).status).toBe(200);
  });

  it("refuses unknown host names (DNS rebinding), but not mock traffic", async () => {
    const { request } = await setup(fixtures());
    expect((await request("/_mittens/api/services", { headers: { host: "evil.example:4000" } })).status).toBe(403);
    expect((await request("/_mittens", { headers: { host: "evil.example" } })).status).toBe(403);
    expect((await request("/_mittens/api/services", { headers: { host: "192.168.1.20:4000" } })).status).toBe(200);
    expect((await request("/users/1", { headers: { host: "evil.example" } })).status).toBe(200);
  });

  it("answers CORS for pages on localhost, and only those", async () => {
    const { request } = await setup(fixtures());
    const pre = await request("/_mittens/api/profiles/x/apply", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    const get = await request("/_mittens/api/profiles", { headers: { origin: "http://localhost:5173" } });
    expect(get.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const evil = await request("/_mittens/api/profiles", { headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("hooked services are marked", () => {
  it("in the services table and the overview diagram", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-hooked-"));
    const store = new Store(new FileRepo(dir));
    await store.load();
    await store.createService({ id: "cart", name: "Cart", path: "/cart", defaultScenario: "ok", scenarios: [{ id: "ok", name: "OK" }] });
    await writeFile(path.join(dir, "services/cart/hook.js"), "export const request = () => ({ body: 'x' });\n");
    const hooks = new Hooks(dir);
    await hooks.load(["cart"]);
    const app = createApp({ store, history: new History(), hooks });
    const text = async (p: string) => (await app.request(`http://localhost${p}`)).text();
    expect(await text("/_mittens/services")).toContain('<span class="pill hook"');
    expect(await text("/_mittens")).toContain("hook answers · static");
  });
});
