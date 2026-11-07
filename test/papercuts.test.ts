import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Service } from "../src/core/schema.js";
import { layoutDiagram } from "../src/ui/flow.js";
import { init } from "../src/init.js";
import { fixtures, form, json, setup } from "./helpers.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("init --no-examples", () => {
  it("writes only the agent notes", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-noex-"));
    expect(await init(dir, { examples: false })).toMatchObject({ created: false, agents: "created", claude: "created" });
    expect((await readdir(dir)).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(existsSync(path.join(dir, "services"))).toBe(false);
  });
});

describe("live stream: state and definitions events", () => {
  it("tells clients when live state or definitions change, and stops on disconnect", async () => {
    const { request, store } = await setup(fixtures(), undefined, [{ id: "p", name: "P", description: "", services: { users: { mode: "static" } } }]);
    const before = store.events.listenerCount("state");
    const abort = new AbortController();
    const res = await request("/_mimic/api/events", { signal: abort.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) text += dec.decode((await reader.read()).value);
    };
    await until(": connected");
    await request("/_mimic/api/profiles/p/apply", { method: "POST" });
    await until("event: state");
    expect(text).toContain('"modified":["users"]');
    await request("/_mimic/api/services/users/scenarios/new-one", { method: "PUT", headers: json, body: JSON.stringify({ name: "New" }) });
    await until("event: definitions");
    expect(store.events.listenerCount("state")).toBe(before + 1);
    abort.abort();
    await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    expect(store.events.listenerCount("state")).toBe(before);
  });
});

describe("overview diagram", () => {
  const svc = (id: string, extra: Record<string, unknown> = {}) => Service.parse({ id, name: id, path: `/${id}`, ...extra });

  it("draws one hint line for an unused upstream, and every live proxy link", () => {
    const unused = layoutDiagram([svc("a", { upstream: "https://api.real.dev" }), svc("b", { upstream: "https://api.real.dev" }), svc("c", { upstream: "https://api.real.dev" })]);
    expect(unused.services.map((s) => s.upstream?.drawn)).toEqual([true, false, false]);
    const live = layoutDiagram([
      svc("a", { upstream: "https://api.real.dev" }),
      svc("b", { upstream: "https://api.real.dev", mode: "proxy" }),
      svc("c", { upstream: "https://api.real.dev", mode: "proxy" }),
    ]);
    expect(live.services.map((s) => s.upstream?.drawn)).toEqual([false, true, true]);
  });

  it("cuts long names at a word and shows the full name, id and route on hover", async () => {
    const { request } = await setup([{ id: "add-cart-item", name: "Add a product to the cart", path: "/api/cart/items", method: "POST" }]);
    const html = await (await request("/_mimic")).text();
    expect(html).toContain(">Add a product to…</text>");
    expect(html).toContain("<title>Add a product to the cart (add-cart-item)\nPOST /api/cart/items</title>");
  });

  it("explains counts on answers that can't be used now", async () => {
    const { request, store } = await setup(fixtures());
    store.setLiveState("users", { mode: "static" });
    const html = await (await request("/_mimic/services/users")).text();
    expect(html).toContain("<title>Boom: can&#39;t answer in static mode; its count is from earlier requests</title>");
    expect(html).toContain("(counts are from earlier requests)");
  });
});

describe("changed and Reset are one control", () => {
  it("in the services row", async () => {
    const { request } = await setup(fixtures());
    const row = await (await request("/_mimic/ui/services/users", form({ mode: "static", defaultScenario: "boom" }))).text();
    expect(row).toMatch(/<button type="button" class="changed-reset"[^>]*><span class="changed-label">changed<\/span><span>Reset<\/span><\/button>/);
  });
});
