import { describe, expect, it } from "vitest";
import { schemaKeyFor, validateResponse } from "../src/core/validate.js";
import { form, json, setup, type ServiceInput } from "./helpers.js";

const user = {
  type: "object",
  required: ["id", "email"],
  additionalProperties: false,
  properties: { id: { type: "string" }, email: { type: "string", format: "email" }, role: { enum: ["admin", "user"] } },
};

const service = (overrides: Partial<ServiceInput> = {}): ServiceInput => ({
  id: "users",
  name: "Users",
  path: "/users/{id}",
  mode: "dynamic",
  defaultScenario: "good",
  responseSchema: { "2xx": user, "404": { type: "object", required: ["error"] } },
  scenarios: [
    { id: "good", name: "Good", status: 200, headers: { "content-type": "application/json" }, body: '{"id":"1","email":"a@b.co"}', tags: [] },
    { id: "drifted", name: "Drifted", status: 200, headers: {}, body: '{"id":1,"mail":"x","role":"root"}', tags: [], match: { params: { id: "2" } } },
    { id: "missing", name: "Missing", status: 404, headers: {}, body: '{"error":"nope"}', tags: [], match: { params: { id: "404" } } },
    { id: "boom", name: "Boom", status: 500, headers: {}, body: "oops", tags: [], match: { params: { id: "500" } } },
  ],
  ...overrides,
});

describe("validateResponse", () => {
  it("picks exact status, then class, then default", () => {
    const schemas = { "200": true, "2xx": true, default: true };
    expect(schemaKeyFor(schemas, 200)).toBe("200");
    expect(schemaKeyFor(schemas, 201)).toBe("2xx");
    expect(schemaKeyFor(schemas, 503)).toBe("default");
    expect(schemaKeyFor({ "2xx": true }, 500)).toBeUndefined();
  });

  it("explains failures", () => {
    const r = validateResponse({ "2xx": user }, 200, '{"id":1,"mail":"x","role":"root"}')!;
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        "(root): must have required property 'email'",
        "(root): unexpected property 'mail'",
        "/id: must be string",
        '/role: must be one of ["admin","user"]',
      ]),
    );
    expect(validateResponse({ "2xx": user }, 200, "<html>")!.errors).toEqual(["Body is not valid JSON"]);
    expect(validateResponse({ "2xx": user }, 200, '{"id":"1","email":"not-an-email"}')!.errors).toEqual(['/email: must match format "email"']);
  });

  it("supports draft-07 and 2020-12 keywords", () => {
    const d7 = { $schema: "http://json-schema.org/draft-07/schema#", type: "array", items: [{ type: "string" }], additionalItems: false };
    expect(validateResponse({ default: d7 }, 200, '["a"]')!.ok).toBe(true);
    expect(validateResponse({ default: d7 }, 200, '["a", 1]')!.ok).toBe(false);
    const y2020 = { type: "array", prefixItems: [{ type: "string" }], items: false };
    expect(validateResponse({ default: y2020 }, 200, '["a", 1]')!.ok).toBe(false);
  });
});

describe("response validation", () => {
  it("checks every mocked response and reports via header and history", async () => {
    const { request, history } = await setup([service()]);
    const good = await request("/users/1");
    expect(good.headers.get("x-mimic-validation")).toBe("pass");
    const bad = await request("/users/2");
    expect(bad.status).toBe(200); // validation reports; it doesn't change the response
    expect(bad.headers.get("x-mimic-validation")).toBe("fail");
    expect((await request("/users/404")).headers.get("x-mimic-validation")).toBe("pass");
    expect((await request("/users/500")).headers.has("x-mimic-validation")).toBe(false); // no schema for 5xx

    const entries = history.list();
    expect(entries[2]!.validation).toMatchObject({ schema: "2xx", ok: false });
    expect(history.list({ validation: "fail" })).toHaveLength(1);
    const failed = (await (await request("/_mimic/api/history?validation=fail")).json()) as unknown[];
    expect(failed).toHaveLength(1);
  });

  it("checks proxied responses", async () => {
    const fetchImpl = (async () => new Response('{"id":"9"}', { headers: { "content-type": "application/json" } })) as typeof fetch;
    const { request, history } = await setup([service({ mode: "proxy", upstream: "https://real.test" })], fetchImpl);
    const res = await request("/users/9");
    expect(res.headers.get("x-mimic-validation")).toBe("fail");
    expect(history.list()[0]!.validation!.errors).toEqual(["(root): must have required property 'email'"]);
  });

  it("doesn't validate Mimic's own errors", async () => {
    const { request } = await setup([service({ defaultScenario: undefined, mode: "static" })]);
    const res = await request("/users/1");
    expect(res.headers.get("x-mimic-source")).toBe("error");
    expect(res.headers.has("x-mimic-validation")).toBe(false);
  });

  it("rejects invalid schemas and keys", async () => {
    const { request } = await setup([service()]);
    const patch = (body: unknown) => request("/_mimic/api/services/users", { method: "PATCH", headers: json, body: JSON.stringify(body) });
    const badSchema = await patch({ responseSchema: { "2xx": { type: "nonsense" } } });
    expect(badSchema.status).toBe(400);
    expect(await badSchema.text()).toContain("Invalid JSON Schema");
    expect((await patch({ responseSchema: { ok: true } })).status).toBe(400);
    expect((await patch({ responseSchema: { "5xx": { type: "object" } } })).status).toBe(200);
  });

  it("dashboard: scenarios show whether they match; history shows the result", async () => {
    const { request, history } = await setup([service()]);
    const page = await (await request("/_mimic/services/users")).text();
    expect(page.match(/schema ✓/g)).toHaveLength(2); // good, missing
    expect(page.match(/schema ✗/g)).toHaveLength(1); // drifted
    expect(page).toContain("<h2>Response schema</h2>");

    await request("/users/2");
    const id = history.list()[0]!.id;
    const detail = await (await request(`/_mimic/history/${id}`)).text();
    expect(detail).toContain("doesn&#39;t match the service&#39;s <code>2xx</code> schema");
    expect(detail).toContain("/id: must be string");
    expect(await (await request("/_mimic/ui/history?validation=fail")).text()).toContain("schema ✗");
    expect(await (await request("/_mimic/ui/history?validation=pass")).text()).toContain("No requests yet");
  });

  it("form accepts JSON, reports bad JSON or schemas, and clears", async () => {
    const { request, store } = await setup([service()]);
    const base = { name: "Users", path: "/users/{id}", method: "ANY", mode: "dynamic", delayMs: "0", defaultScenario: "good" };
    const edit = await (await request("/_mimic/services/users/edit")).text();
    expect(edit).toContain("&quot;2xx&quot;: {");

    let res = await request("/_mimic/services/users", form({ ...base, responseSchema: "{ nope" }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Not valid JSON");
    res = await request("/_mimic/services/users", form({ ...base, responseSchema: '{"2xx": {"type": 5}}' }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Invalid JSON Schema");

    res = await request("/_mimic/services/users", form({ ...base, responseSchema: '{"default": {"type": "object"}}' }));
    expect(res.status).toBe(303);
    expect(store.getDefinition("users").responseSchema).toEqual({ default: { type: "object" } });
    await request("/_mimic/services/users", form(base));
    expect(store.getDefinition("users").responseSchema).toBeUndefined();
  });
});
