import { describe, expect, it } from "vitest";
import type { Scenario } from "../src/core/schema.js";
import { form, json, setup } from "./helpers.js";

const sc = (id: string, match: Scenario["match"]): Scenario => ({ id, name: id, status: 200, headers: {}, body: id, tags: [], match });

const orders = (scenarios: Scenario[]) =>
  setup([{ id: "orders", path: "/orders/{id}", mode: "dynamic", defaultScenario: "fallback", scenarios: [sc("fallback", undefined), ...scenarios] }]);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  ({ method: "POST", headers: { ...json, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }) as RequestInit;

describe("regex matching", () => {
  it("tests params, query and headers with regular expressions", async () => {
    const { request } = await orders([
      sc("nineties", { params: { id: { regex: "^9\\d$" } } }),
      sc("beta", { query: { channel: { regex: "^beta", flags: "i" } } }),
      sc("mobile", { headers: { "user-agent": { regex: "iPhone|Android" } } }),
    ]);
    expect(await (await request("/orders/95")).text()).toBe("nineties");
    expect(await (await request("/orders/950")).text()).toBe("fallback");
    expect(await (await request("/orders/1?channel=BETA-2")).text()).toBe("beta");
    expect(await (await request("/orders/1", { headers: { "user-agent": "Mozilla (iPhone)" } })).text()).toBe("mobile");
    expect(await (await request("/orders/1")).text()).toBe("fallback"); // absent values never match a regex
  });

  it("prefers exact criteria over regexes when the count ties", async () => {
    const { request } = await orders([sc("any", { params: { id: { regex: ".*" } } }), sc("exact", { params: { id: "404" } })]);
    expect(await (await request("/orders/404")).text()).toBe("exact");
    expect(await (await request("/orders/5")).text()).toBe("any");
  });

  it("still lets more criteria win over exactness", async () => {
    const { request } = await orders([
      sc("exact", { params: { id: "7" } }),
      sc("two-regexes", { params: { id: { regex: "\\d" } }, query: { v: { regex: "." } } }),
    ]);
    expect(await (await request("/orders/7?v=1")).text()).toBe("two-regexes");
  });

  it("bodyMatches tests the raw body", async () => {
    const { request } = await orders([sc("refund", { bodyMatches: { regex: '"type"\\s*:\\s*"REFUND"', flags: "i" } })]);
    expect(await (await request("/orders/1", post('{ "type" : "refund" }'))).text()).toBe("refund");
    expect(await (await request("/orders/1", post('{"type":"sale"}'))).text()).toBe("fallback");
  });
});

describe("JSONPath matching", () => {
  it("equals, regex, exists and missing", async () => {
    const { request } = await orders([
      sc("admin", { json: { "$.user.role": "admin" } }),
      sc("big", { json: { "$.qty": 100 } }),
      sc("x-sku", { json: { "$.items[*].sku": { regex: "^X-" } } }),
      sc("coupon", { json: { "$.coupon": { exists: true } } }),
      sc("guest", { json: { "$.user": { exists: false }, "$.cart": { exists: true } } }),
    ]);
    const answer = async (body: unknown) => (await request("/orders/1", post(body))).text();
    expect(await answer({ user: { role: "admin" } })).toBe("admin");
    expect(await answer({ qty: 100 })).toBe("big");
    expect(await answer({ qty: "100" })).toBe("fallback"); // 100 (number) doesn't equal "100"
    expect(await answer({ items: [{ sku: "A-1" }, { sku: "X-9" }] })).toBe("x-sku");
    expect(await answer({ coupon: null })).toBe("coupon");
    expect(await answer({ cart: [] })).toBe("guest");
    expect(await answer("not json")).toBe("fallback");
  });

  it("a string test also equals numbers and booleans written the same way", async () => {
    const { request } = await orders([sc("seven", { json: { "$.id": "7" } }), sc("yes", { json: { "$.ok": "true" } })]);
    expect(await (await request("/orders/1", post({ id: 7 }))).text()).toBe("seven");
    expect(await (await request("/orders/1", post({ ok: true }))).text()).toBe("yes");
  });

  it("supports filter expressions safely", async () => {
    const { request } = await orders([sc("has-gift", { json: { "$.items[?(@.gift === true)].sku": { exists: true } } })]);
    expect(await (await request("/orders/1", post({ items: [{ sku: "a" }, { sku: "b", gift: true }] }))).text()).toBe("has-gift");
    expect(await (await request("/orders/1", post({ items: [{ sku: "a" }] }))).text()).toBe("fallback");
  });

  it("rejects bad definitions", async () => {
    const { request } = await orders([]);
    const put = (match: unknown) =>
      request("/_mimic/api/services/orders/scenarios/x", { method: "PUT", headers: json, body: JSON.stringify({ name: "X", match }) });
    expect((await put({ json: { "user.role": "admin" } })).status).toBe(400);
    expect((await put({ params: { id: { regex: "(" } } })).status).toBe(400);
    expect((await put({ bodyMatches: { regex: "a", flags: "g" } })).status).toBe(400);
    expect((await put({ json: { "$.a": { regex: "^b" } }, params: { id: { regex: "\\d+" } } })).status).toBe(200);
  });
});

describe("scenario form match syntax", () => {
  const base = { name: "X", status: "200" };

  it("parses and round-trips regex lines, JSONPath lines and body regex", async () => {
    const { request, store } = await orders([]);
    const res = await request(
      "/_mimic/services/orders/scenarios",
      form({
        ...base,
        id: "x",
        "match.params": "id ~ ^9\\d$\nkind: plain",
        "match.headers": "user-agent ~i iphone",
        "match.json": '$.user.role = admin\n$.qty = 100\n$.code = "100"\n$.items[*].sku ~ ^X-\n$.coupon exists\n$.legacy missing',
        "match.bodyMatches": "refund",
        "match.bodyMatchesFlags": "i",
      }),
    );
    expect(res.status).toBe(303);
    const match = store.getScenario("orders", "x").match!;
    expect(match).toEqual({
      params: { id: { regex: "^9\\d$" }, kind: "plain" },
      headers: { "user-agent": { regex: "iphone", flags: "i" } },
      json: {
        "$.user.role": "admin",
        "$.qty": 100,
        "$.code": "100",
        "$.items[*].sku": { regex: "^X-" },
        "$.coupon": { exists: true },
        "$.legacy": { exists: false },
      },
      bodyMatches: { regex: "refund", flags: "i" },
    });

    const edit = await (await request("/_mimic/services/orders/scenarios/x/edit")).text();
    expect(edit).toContain(">id ~ ^9\\d$\nkind: plain</textarea>");
    expect(edit).toContain(">user-agent ~i iphone</textarea>");
    expect(edit).toContain('$.qty = 100\n$.code = &quot;100&quot;\n$.items[*].sku ~ ^X-\n$.coupon exists\n$.legacy missing</textarea>');
  });

  it("reports bad lines", async () => {
    const { request } = await orders([]);
    const submit = (fields: Record<string, string>) => request("/_mimic/services/orders/scenarios", form({ ...base, id: "y", ...fields }));
    let res = await submit({ "match.params": "id ~ (" });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Line 1: &quot;(&quot; is not a valid regular expression");
    res = await submit({ "match.json": "$.a = 1\nuser.role = admin" });
    expect(await res.text()).toContain("Line 2: JSONPath expressions start with $");
    res = await submit({ "match.json": "$.a" });
    expect(await res.text()).toContain("Line 1: expected");
    res = await submit({ "match.bodyMatches": "[" });
    expect(await res.text()).toContain("Not a valid regular expression");
  });
});
