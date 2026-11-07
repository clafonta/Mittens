import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { History } from "../src/core/history.js";
import { Hooks } from "../src/core/hooks.js";
import { FileRepo } from "../src/core/repo.js";
import { Store } from "../src/core/store.js";
import { createApp } from "../src/http/app.js";
import { fixtures, form, json, setup } from "./helpers.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Puts a fixture Mimic into a "dirty" state: live change, tag filter, history. */
async function dirty() {
  const ctx = await setup(fixtures());
  await ctx.request("/users/1");
  await ctx.request("/orders");
  ctx.store.setLiveState("users", { mode: "static", defaultScenario: "boom", delayMs: 50 });
  ctx.store.setActiveTags(["checkout"]);
  return ctx;
}

describe("POST /_mimic/api/reset", () => {
  it("resets live state, the tag filter and history in one call", async () => {
    const { request, store, history } = await dirty();
    expect(history.list()).toHaveLength(2);
    const res = await request("/_mimic/api/reset", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reset: ["state", "tags", "hooks", "history"], services: ["users"], tags: ["checkout"], history: 2 });
    expect(store.modifiedServiceIds()).toEqual([]);
    expect(store.activeTags).toEqual([]);
    expect(history.list()).toHaveLength(0);
    // nothing left to do the second time
    expect(await (await request("/_mimic/api/reset", { method: "POST" })).json()).toMatchObject({ services: [], tags: [], history: 0 });
  });

  it("keeps the parts named in the body or the query", async () => {
    const { request, store, history } = await dirty();
    const res = await request("/_mimic/api/reset", { method: "POST", headers: json, body: JSON.stringify({ keep: ["history"] }) });
    expect(await res.json()).toMatchObject({ reset: ["state", "tags", "hooks"], history: 0 });
    expect(history.list()).toHaveLength(2);
    store.setLiveState("users", { mode: "static" });
    await request("/_mimic/api/reset?keep=state,history", { method: "POST" });
    expect(store.modifiedServiceIds()).toEqual(["users"]);
    expect(history.list()).toHaveLength(2);
  });

  it("rejects unknown parts and fields", async () => {
    const { request } = await setup(fixtures());
    const bad = (init: RequestInit, q = "") => request(`/_mimic/api/reset${q}`, { method: "POST", ...init });
    expect((await bad({ headers: json, body: JSON.stringify({ keep: ["files"] }) })).status).toBe(400);
    expect((await bad({ headers: json, body: JSON.stringify({ everything: true }) })).status).toBe(400);
    expect((await bad({}, "?keep=files")).status).toBe(400);
    expect((await bad({ headers: json, body: "{" })).status).toBe(400);
  });

  it("is refused from other websites", async () => {
    const { request } = await setup(fixtures());
    expect((await request("/_mimic/api/reset", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("clears hook state, ctx.shared included", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-reset-"));
    const store = new Store(new FileRepo(dir));
    await store.load();
    await store.createService({ id: "cart", name: "cart", path: "/cart", scenarios: [{ id: "ok", name: "OK", body: "ok" }] });
    await writeFile(
      path.join(dir, "services", "cart", "hook.js"),
      `export const request = (req, ctx) => { ctx.state.n = (ctx.state.n ?? 0) + 1; ctx.shared.n = (ctx.shared.n ?? 0) + 1; return { body: ctx.state.n + "/" + ctx.shared.n }; };`,
    );
    const hooks = new Hooks(dir);
    await hooks.load(["cart"]);
    const app = createApp({ store, history: new History(), hooks });
    const call = async (p: string, i?: RequestInit) => (await app.request(`http://localhost${p}`, i)).text();
    await call("/cart");
    expect(await call("/cart")).toBe("2/2");
    await call("/_mimic/api/reset", { method: "POST" });
    expect(await call("/cart")).toBe("1/1");
    await call("/_mimic/api/reset", { method: "POST", headers: json, body: JSON.stringify({ keep: ["hooks"] }) });
    expect(await call("/cart")).toBe("2/2");
  });
});

describe("Start over on the Settings page", () => {
  it("offers the button and resets, optionally keeping history", async () => {
    const { request, store, history } = await dirty();
    expect(await (await request("/_mimic/settings")).text()).toContain('action="/_mimic/reset"');

    const kept = await request("/_mimic/reset", form({ keepHistory: "1" }));
    expect(kept.status).toBe(303);
    expect(decodeURIComponent(kept.headers.get("location")!)).toContain("1 service reset, tag filter cleared, hook state cleared");
    expect(store.modifiedServiceIds()).toEqual([]);
    expect(history.list()).toHaveLength(2);

    const all = await request("/_mimic/reset", form({}));
    expect(decodeURIComponent(all.headers.get("location")!)).toContain("2 requests cleared from history");
    expect(history.list()).toHaveLength(0);
  });
});
