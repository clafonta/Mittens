import { describe, expect, it } from "vitest";
import { HISTORY_BODY_LIMIT } from "../src/core/engine.js";
import { slugify } from "../src/core/record.js";
import { form, json, setup } from "./helpers.js";

const upstreamJson = (body: string, status = 200, extra: Record<string, string> = {}) =>
  (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json", date: "Tue, 01 Jan 2030 00:00:00 GMT", "x-request-id": "abc", ...extra },
    })) as typeof fetch;

const proxied = {
  id: "users",
  name: "Users",
  path: "/api/users/{id}",
  mode: "proxy" as const,
  upstream: "https://real.test",
};

async function recordOne(fetchImpl = upstreamJson('{"id":"7","name":"Grace"}')) {
  const ctx = await setup([proxied], fetchImpl);
  await ctx.request("/api/users/7?expand=roles");
  const entry = ctx.history.list()[0]!;
  return { ...ctx, entry };
}

describe("slugify", () => {
  it("makes safe ids", () => {
    expect(slugify("GET-users-7-200")).toBe("get-users-7-200");
    expect(slugify("  ~~ ")).toBe("recorded");
    expect(slugify("a".repeat(80)).length).toBe(48);
  });
});

describe("record to scenario (UI)", () => {
  it("offers 'Save as scenario' and prefills the form from the recording", async () => {
    const { request, entry } = await recordOne();
    const detail = await (await request(`/_mimic/history/${entry.id}`)).text();
    expect(detail).toContain(`/_mimic/services/users/scenarios/new?from=${entry.id}`);

    const html = await (await request(`/_mimic/services/users/scenarios/new?from=${entry.id}`)).text();
    expect(html).toContain("Save recorded response as a scenario of Users");
    expect(html).toContain('value="get-users-7-200"');
    expect(html).toContain("{&quot;id&quot;:&quot;7&quot;,&quot;name&quot;:&quot;Grace&quot;}");
    expect(html).toContain("content-type: application/json\nx-request-id: abc");
    expect(html).not.toContain("date: Tue");
    expect(html).toContain(">id: 7</textarea>");
    expect(html).toContain(">expand: roles</textarea>");
  });

  it("saves the reviewed form as a working scenario", async () => {
    const { request, store, entry } = await recordOne();
    const values = await (await request(`/_mimic/services/users/scenarios/new?from=${entry.id}`)).text();
    expect(values).toContain("Recorded GET /api/users/7 → 200");

    const res = await request(
      "/_mimic/services/users/scenarios",
      form({ id: "grace", name: "Grace", status: "200", headers: "content-type: application/json", body: '{"id":"7"}', "match.params": "id: 7" }),
    );
    expect(res.status).toBe(303);
    store.setLiveState("users", { mode: "dynamic" });
    const replay = await request("/api/users/7");
    expect(replay.headers.get("x-mimic-scenario")).toBe("grace");
  });

  it("blocks truncated recordings", async () => {
    const big = "x".repeat(HISTORY_BODY_LIMIT + 10);
    const { request, entry } = await recordOne(upstreamJson(big));
    expect(entry.response.truncated).toBe(true);
    expect(await (await request(`/_mimic/history/${entry.id}`)).text()).toContain("Body truncated");
    const html = await (await request(`/_mimic/services/users/scenarios/new?from=${entry.id}`)).text();
    expect(html).toContain("was truncated");
    expect(html).not.toContain("<form method=\"post\" action=\"/_mimic/services/users/scenarios\"");
  });

  it("warns about binary bodies", async () => {
    const { request, entry } = await recordOne((async () => new Response("PNG", { headers: { "content-type": "image/png" } })) as typeof fetch);
    expect(await (await request(`/_mimic/services/users/scenarios/new?from=${entry.id}`)).text()).toContain("binary content may not replay");
  });

  it("404s for an unknown history entry", async () => {
    const { request } = await recordOne();
    expect((await request("/_mimic/services/users/scenarios/new?from=nope")).status).toBe(404);
  });
});

describe("record to scenario (API)", () => {
  const post = (v?: unknown) => ({ method: "POST", headers: json, body: v === undefined ? undefined : JSON.stringify(v) });

  it("creates a scenario with generated id, then a unique one", async () => {
    const { request, store, entry } = await recordOne();
    const first = await request(`/_mimic/api/history/${entry.id}/scenario`, post());
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ id: "get-users-7-200", serviceId: "users", match: { params: { id: "7" }, query: { expand: "roles" } } });

    const second = await request(`/_mimic/api/history/${entry.id}/scenario`, post({ name: "Again", makeDefault: true }));
    expect(await second.json()).toMatchObject({ id: "get-users-7-200-2", name: "Again" });
    expect(store.getDefinition("users").defaultScenario).toBe("get-users-7-200-2");
  });

  it("rejects bad input", async () => {
    const { request, entry } = await recordOne();
    expect((await request(`/_mimic/api/history/${entry.id}/scenario`, { method: "POST", body: "{nope" })).status).toBe(400);
    expect((await request(`/_mimic/api/history/${entry.id}/scenario`, post({ id: "Bad Id" }))).status).toBe(400);
    expect((await request(`/_mimic/api/history/missing/scenario`, post())).status).toBe(404);
  });

  it("needs a service for unmatched requests", async () => {
    const { request, history } = await setup([proxied]);
    await request("/nowhere");
    const id = history.list()[0]!.id;
    expect((await request(`/_mimic/api/history/${id}/scenario`, post())).status).toBe(400);
    expect((await request(`/_mimic/api/history/${id}/scenario`, post({ service: "users" }))).status).toBe(201);
  });
});
