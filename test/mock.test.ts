import { describe, expect, it, vi } from "vitest";
import { json, setup } from "./helpers.js";

const users = {
  id: "users",
  path: "/api/users/{id}",
  method: "GET" as const,
  mode: "dynamic" as const,
  defaultScenario: "found",
  scenarios: [
    { id: "found", name: "Found", status: 200, headers: json, body: '{"id":"1"}', tags: [] },
    { id: "missing", name: "Missing", status: 404, headers: json, body: "{}", match: { params: { id: "404" } }, tags: [] },
    {
      id: "admin",
      name: "Admin",
      status: 200,
      headers: json,
      body: '{"admin":true}',
      match: { params: { id: "404" }, headers: { "x-role": "admin" } },
      tags: [],
    },
  ],
};

describe("mock traffic", () => {
  it("returns 404 with a helpful body when no service matches", async () => {
    const { request, history } = await setup([]);
    const res = await request("/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-mimic-source")).toBe("unmatched");
    expect(await res.json()).toEqual({ mimic: { error: "No service matches GET /nope" } });
    expect(history.list()[0]?.source).toBe("unmatched");
  });

  it("static mode returns the default scenario", async () => {
    const { request } = await setup([{ ...users, mode: "static" }]);
    const res = await request("/api/users/404");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-mimic-scenario")).toBe("found");
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("static mode without a default scenario is a 500", async () => {
    const { request } = await setup([{ ...users, mode: "static", defaultScenario: undefined }]);
    expect((await request("/api/users/1")).status).toBe(500);
  });

  it("dynamic mode picks the most specific matching scenario", async () => {
    const { request } = await setup([users]);
    expect((await request("/api/users/404")).headers.get("x-mimic-scenario")).toBe("missing");
    const admin = await request("/api/users/404", { headers: { "x-role": "admin" } });
    expect(admin.headers.get("x-mimic-scenario")).toBe("admin");
  });

  it("dynamic mode falls back to the default scenario", async () => {
    const { request } = await setup([users]);
    const res = await request("/api/users/7");
    expect(res.headers.get("x-mimic-scenario")).toBe("found");
    expect(res.headers.get("x-mimic-source")).toBe("fallback");
  });

  it("matches on query and body", async () => {
    const { request } = await setup([
      {
        id: "search",
        path: "/search",
        mode: "dynamic",
        scenarios: [
          { id: "q", name: "q", status: 200, headers: {}, body: "query", match: { query: { q: "cats" } }, tags: [] },
          { id: "b", name: "b", status: 201, headers: {}, body: "body", match: { method: "POST", bodyContains: "DOGS" }, tags: [] },
        ],
      },
    ]);
    expect(await (await request("/search?q=cats")).text()).toBe("query");
    expect((await request("/search", { method: "POST", body: '{"pet":"dogs"}' })).status).toBe(201);
    expect((await request("/search?q=birds")).status).toBe(404);
  });

  it("respects method and specificity when resolving services", async () => {
    const { request } = await setup([
      { id: "any", path: "/api/*", mode: "static", defaultScenario: "a", scenarios: [{ id: "a", name: "a", status: 200, headers: {}, body: "wild", tags: [] }] },
      { id: "me", path: "/api/me", method: "GET", mode: "static", defaultScenario: "a", scenarios: [{ id: "a", name: "a", status: 200, headers: {}, body: "me", tags: [] }] },
    ]);
    expect(await (await request("/api/me")).text()).toBe("me");
    expect(await (await request("/api/me", { method: "POST" })).text()).toBe("wild");
    expect(await (await request("/api/other")).text()).toBe("wild");
  });

  it("applies scenario delay over service delay", async () => {
    const { request, history } = await setup([
      { id: "slow", path: "/slow", mode: "static", delayMs: 1000, defaultScenario: "s", scenarios: [{ id: "s", name: "s", status: 200, headers: {}, body: "", delayMs: 30, tags: [] }] },
    ]);
    await request("/slow");
    const ms = history.list()[0]!.durationMs;
    expect(ms).toBeGreaterThanOrEqual(25);
    expect(ms).toBeLessThan(500);
  });

  it("answers CORS preflight and adds CORS headers", async () => {
    const { request } = await setup([users]);
    const pre = await request("/api/users/1", {
      method: "OPTIONS",
      headers: { origin: "http://app.test", "access-control-request-method": "GET" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("http://app.test");
    const res = await request("/api/users/1", { headers: { origin: "http://app.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://app.test");
  });

  describe("proxy mode", () => {
    const proxied = { id: "up", path: "/v1/*", mode: "proxy" as const, upstream: "https://real.test/base/", errorScenario: undefined };

    it("forwards method, path, query, headers and body", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        new Response("upstream says hi", { status: 201, headers: { "x-up": "1", connection: "keep-alive" } }),
      );
      const { request, history } = await setup([proxied], fetchImpl);
      const res = await request("/v1/things?x=1", { method: "POST", headers: { "x-token": "t" }, body: "payload" });

      expect(res.status).toBe(201);
      expect(await res.text()).toBe("upstream says hi");
      expect(res.headers.get("x-up")).toBe("1");
      expect(res.headers.get("x-mimic-source")).toBe("proxy");

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(String(url)).toBe("https://real.test/base/v1/things?x=1");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-token")).toBe("t");
      expect(new Headers(init?.headers).get("host")).toBeNull();
      expect(history.list()[0]?.response.body).toBe("upstream says hi");
    });

    it("returns 502 when upstream fails and no error scenario exists", async () => {
      const { request } = await setup([proxied], async () => {
        throw new Error("ECONNREFUSED");
      });
      const res = await request("/v1/x");
      expect(res.status).toBe(502);
      expect(((await res.json()) as { mimic: { error: string } }).mimic.error).toContain("ECONNREFUSED");
    });

    it("uses the error scenario when upstream fails", async () => {
      const { request } = await setup(
        [{ ...proxied, errorScenario: "down", scenarios: [{ id: "down", name: "Down", status: 503, headers: {}, body: "maintenance", tags: [] }] }],
        async () => {
          throw new Error("boom");
        },
      );
      const res = await request("/v1/x");
      expect(res.status).toBe(503);
      expect(res.headers.get("x-mimic-source")).toBe("fallback");
    });
  });
});
