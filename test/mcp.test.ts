import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { refuse } from "../src/mcp/http.js";
import { fixtures, json, setup } from "./helpers.js";

/** An MCP client talking to the in-process app over Streamable HTTP. */
async function connect(services = fixtures(), fetchImpl?: typeof fetch) {
  const ctx = await setup(services, fetchImpl);
  const client = new Client({ name: "test-assistant", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/_mimic/mcp"), {
    fetch: ((url: string | URL, init?: RequestInit) => ctx.app.request(String(url), init)) as typeof fetch,
  });
  await client.connect(transport);
  /** Calls a tool and parses its JSON result; throws on tool errors. */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
    const text = res.content[0]!.text;
    if (res.isError) throw new Error(text);
    return JSON.parse(text) as Record<string, any>;
  };
  return { ...ctx, client, call };
}

describe("MCP endpoint", () => {
  it("introduces itself and lists its tools", async () => {
    const { client } = await connect();
    expect(client.getServerVersion()?.name).toBe("mimic");
    expect(client.getInstructions()).toContain("Start with get_overview");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "apply_profile", "create_service", "delete_scenario", "delete_service", "explain_request", "get_overview", "get_request", "get_service",
        "import_openapi", "list_requests", "read_help", "replay_request", "reset_live_state", "save_live_state", "save_profile",
        "save_request_as_scenario", "send_request", "set_live_state", "update_service", "upsert_scenario",
      ].sort(),
    );
    const del = tools.find((t) => t.name === "delete_service")!;
    expect(del.annotations).toMatchObject({ destructiveHint: true });
    expect(tools.find((t) => t.name === "get_overview")!.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("builds a mock end to end: create, add scenarios, check with a request", async () => {
    const { call, store } = await connect([]);
    await call("create_service", { id: "payments", name: "Payments", path: "/api/payments/{id}", method: "POST", mode: "dynamic" });
    await call("upsert_scenario", { service: "payments", id: "ok", name: "Paid", body: { status: "paid" } });
    await call("upsert_scenario", {
      service: "payments",
      id: "declined",
      name: "Card declined",
      status: 402,
      body: { error: "card_declined" },
      match: { json: { "$.card": { regex: "0002$" } } },
    });
    expect(store.getDefinition("payments").defaultScenario).toBe("ok"); // first scenario became the default

    const declined = await call("send_request", { method: "POST", path: "/api/payments/1", body: { card: "4000000000000002" } });
    expect(declined).toMatchObject({ status: 402, answeredBy: { service: "payments", scenario: "declined", source: "scenario" } });
    expect(JSON.parse(declined.body)).toEqual({ error: "card_declined" });
    expect(declined.headers["content-type"]).toBe("application/json");

    const paid = await call("send_request", { method: "POST", path: "/api/payments/2", body: { card: "4242424242424242" } });
    expect(paid).toMatchObject({ status: 200, answeredBy: { scenario: "ok", source: "fallback" } });
  });

  it("switches live state without touching definitions, and explains requests", async () => {
    const { call, request, store } = await connect();
    await call("set_live_state", { service: "users", mode: "static", defaultScenario: "boom" });
    expect(store.getDefinition("users").mode).toBe("dynamic");
    expect((await request("/users/1")).status).toBe(500);
    const overview = await call("get_overview");
    expect(overview.services.find((s: { id: string }) => s.id === "users")).toMatchObject({ mode: "static", defaultScenario: "boom", modified: true });

    const recent = await call("list_requests", { errorsOnly: true });
    expect(recent.requests[0]).toMatchObject({ path: "/users/1", status: 500, scenarioId: "boom" });
    const why = await call("explain_request", { id: recent.requests[0].id });
    expect(why.why).toBe("Static mode always sends the default scenario.");

    await request("/nowhere");
    const unmatched = (await call("list_requests", { limit: 1 })).requests[0];
    expect((await call("explain_request", { id: unmatched.id })).why).toBe("No service's path matches this request.");

    expect((await call("reset_live_state", {})).reset).toEqual(["users"]);
  });

  it("returns readable errors instead of failing", async () => {
    const { client } = await connect();
    const res = (await client.callTool({ name: "get_service", arguments: { id: "nope" } })) as { isError: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe("Service 'nope' not found");
    const bad = (await client.callTool({ name: "create_service", arguments: { id: "Bad Id", name: "x", path: "/x" } })) as { isError: boolean; content: { text: string }[] };
    expect(bad.isError).toBe(true);
  });

  it("serves the help docs", async () => {
    const { call } = await connect();
    const topics = await call("read_help");
    expect(topics.topics.map((t: { topic: string }) => t.topic)).toContain("scenarios");
    expect((await call("read_help", { topic: "templates" })).markdown).toContain("{{params.id}}");
    expect((await call("read_help", { search: "rewrite" })).results[0]).toMatchObject({ topic: "proxying", anchor: "path-rewrites" });
  });

  it("records what assistants do, for the dashboard", async () => {
    const { call, request } = await connect();
    await call("get_overview");
    await call("set_live_state", { service: "users", mode: "static" }).catch(() => {});
    const page = await (await request("/_mimic/assistants")).text();
    expect(page).toContain("test-assistant");
    expect(page).toContain("get_overview");
    expect(page).toContain("set_live_state");
  });
});

describe("MCP endpoint security", () => {
  const req = (host: string, origin?: string) => new Request(`http://${host}/_mimic/mcp`, { method: "POST", headers: { host, ...(origin && { origin }) } });
  it("accepts local hosts and same-origin requests", () => {
    for (const host of ["localhost:4000", "127.0.0.1:4000", "[::1]:4000", "192.168.1.20:4000", "app.localhost:4000"]) expect(refuse(req(host)), host).toBeUndefined();
    expect(refuse(req("localhost:4000", "http://localhost:4000"))).toBeUndefined();
  });
  it("refuses other host names (DNS rebinding) and other origins (web pages)", () => {
    expect(refuse(req("evil.example:4000"))).toContain("isn't allowed");
    expect(refuse(req("localhost:4000", "https://evil.example"))).toContain("aren't allowed");
    expect(refuse(req("localhost:4000", "http://localhost:5173"))).toContain("aren't allowed");
  });
  it("answers refused requests with 403", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mimic/mcp", { method: "POST", headers: { ...json, origin: "https://evil.example" }, body: "{}" });
    expect(res.status).toBe(403);
  });
});
