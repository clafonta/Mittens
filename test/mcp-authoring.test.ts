import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { History } from "../src/core/history.js";
import { Hooks } from "../src/core/hooks.js";
import { FileRepo } from "../src/core/repo.js";
import { Store } from "../src/core/store.js";
import { createApp } from "../src/http/app.js";
import { json } from "./helpers.js";

// Authoring mocks over MCP against a real definitions folder (FRICTION #21-23 from the client project).

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function project() {
  dir = await mkdtemp(path.join(tmpdir(), "mimic-mcp-authoring-"));
  const store = new Store(new FileRepo(dir));
  await store.load();
  for (const id of ["cart", "reviews"]) {
    await store.createService({ id, name: id, path: `/${id}`, defaultScenario: "ok", scenarios: [{ id: "ok", name: "OK", body: "ok" }, { id: "down", name: "Down", status: 503, body: "down" }] });
  }
  await writeFile(path.join(dir, "services", "cart", "hook.js"), `export const request = () => ({ body: "from hook" });`);
  const hooks = new Hooks(dir);
  await hooks.load(["cart", "reviews"]);
  const app = createApp({ store, history: new History(), hooks });
  const client = new Client({ name: "test-assistant", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/_mimic/mcp"), {
      fetch: ((url: string | URL, init?: RequestInit) => app.request(String(url), init)) as typeof fetch,
    }),
  );
  const raw = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; content: { text: string }[] }>;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await raw(name, args);
    if (res.isError) throw new Error(res.content[0]!.text);
    return JSON.parse(res.content[0]!.text) as Record<string, any>;
  };
  const request = (p: string, init?: RequestInit) => app.request(`http://localhost${p}`, init);
  return { dir, store, client, call, raw, request };
}

describe("get_overview and hooks", () => {
  it("says which services a hook answers", async () => {
    const { call } = await project();
    const services = (await call("get_overview")).services as { id: string; hook: string | null }[];
    expect(services.find((s) => s.id === "cart")!.hook).toMatch(/^services\/cart\/hook\.js: code that may answer before any scenario \(exports request\)$/);
    expect(services.find((s) => s.id === "reviews")!.hook).toBeNull();
  });

  it("tells assistants that hooks are files they write, not tool calls", async () => {
    const { client } = await project();
    expect(client.getInstructions()).toContain("These tools don't write hooks");
    const upsert = (await client.listTools()).tools.find((t) => t.name === "upsert_scenario")!;
    expect(upsert.description).toContain("services/<id>/hook.ts");
  });
});

describe("save_profile with merge", () => {
  it("changes only the services given, removes nulls, keeps name and the rest", async () => {
    const { call, dir } = await project();
    await call("save_profile", { id: "happy", name: "Happy", description: "All good.", services: { cart: { mode: "static", scenario: "ok" } } });
    const merged = await call("save_profile", { id: "happy", merge: true, services: { reviews: { mode: "dynamic", scenario: "ok" } } });
    expect(merged.saved).toMatchObject({ name: "Happy", description: "All good.", services: { cart: { mode: "static", scenario: "ok" }, reviews: { mode: "dynamic", scenario: "ok" } } });
    const removed = await call("save_profile", { id: "happy", merge: true, services: { cart: null } });
    expect(Object.keys(removed.saved.services)).toEqual(["reviews"]);

    // one line per service, as people write profiles by hand
    expect(await readFile(path.join(dir, "profiles", "happy.yaml"), "utf8")).toBe(
      "name: Happy\ndescription: All good.\nservices:\n  reviews: { mode: dynamic, scenario: ok }\n",
    );
  });

  it("explains what's missing instead of guessing", async () => {
    const { raw, call } = await project();
    const noName = await raw("save_profile", { id: "x", services: { cart: { mode: "static" } } });
    expect(noName.isError).toBe(true);
    expect(noName.content[0]!.text).toContain("name is required");
    const nullWithoutMerge = await raw("save_profile", { id: "x", name: "X", services: { cart: null } });
    expect(nullWithoutMerge.content[0]!.text).toContain("only make sense with merge: true");
    const missing = await raw("save_profile", { id: "nope", merge: true, services: {} });
    expect(missing.content[0]!.text).toContain("Profile 'nope' not found");
    // replacing still replaces
    await call("save_profile", { id: "p", name: "P", services: { cart: { mode: "static" }, reviews: { mode: "static" } } });
    expect(Object.keys((await call("save_profile", { id: "p", name: "P", services: { reviews: { delayMs: 5 } } })).saved.services)).toEqual(["reviews"]);
  });
});

describe("PATCH /_mimic/api/profiles/:id", () => {
  it("merges like save_profile with merge", async () => {
    const { request, store } = await project();
    await store.putProfile({ id: "p", name: "P", description: "", services: { cart: { mode: "static" } } });
    const res = await request("/_mimic/api/profiles/p", { method: "PATCH", headers: json, body: JSON.stringify({ services: { reviews: { scenario: "down" } } }) });
    expect(res.status).toBe(200);
    expect((await res.json()).services).toEqual({ cart: { mode: "static" }, reviews: { scenario: "down" } });
    const bad = await request("/_mimic/api/profiles/p", { method: "PATCH", headers: json, body: JSON.stringify({ servics: {} }) });
    expect(bad.status).toBe(400);
  });
});
