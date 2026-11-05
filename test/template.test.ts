import { describe, expect, it } from "vitest";
import { MatchInput } from "../src/core/match.js";
import { renderTemplate, templateProblem } from "../src/core/template.js";
import type { Scenario } from "../src/core/schema.js";
import { form, json, setup } from "./helpers.js";

const input = (opts: { path?: string; headers?: Record<string, string>; body?: string; params?: Record<string, string>; method?: string } = {}) =>
  new MatchInput(opts.method ?? "post", new URL(opts.path ?? "/users/7?page=2&tag=a&tag=b", "http://localhost:4000"), new Headers(opts.headers ?? { "X-Tenant": "acme" }), opts.params ?? { id: "7" }, opts.body ?? '{"user":{"name":"Ada \\"the\\" first","tags":["x","y"]},"qty":3}');

const render = (t: string, i = input()) => renderTemplate(t, i);

describe("template rendering", () => {
  it("reads params, query, headers, body and request basics", () => {
    expect(render("{{params.id}} {{ query.page }} {{query.tag}} {{headers.x-tenant}} {{method}} {{path}}")).toBe("7 2 a acme POST /users/7");
    expect(render("{{url}}")).toBe("http://localhost:4000/users/7?page=2&tag=a&tag=b");
    expect(render("{{body.user.name}} {{body.user.tags[1]}} {{body.qty}}")).toBe('Ada "the" first y 3');
    expect(render("{{body.user.tags}}")).toBe('["x","y"]');
    expect(render("{{body}}", input({ body: "raw text" }))).toBe("raw text");
  });

  it("renders missing values as empty, with default as a fallback", () => {
    expect(render("[{{query.nope}}][{{body.a.b.c}}][{{params.zzz}}]")).toBe("[][][]");
    expect(render('{{query.size | default "20"}} {{query.page | default "1"}}')).toBe("20 2");
    expect(render("{{body.x | default 0}}", input({ body: "not json" }))).toBe("0");
  });

  it("filters chain, and json makes values safe inside JSON", () => {
    expect(render("{{headers.x-tenant | upper}} {{ 'MiXeD' | lower }}")).toBe("ACME mixed");
    const out = render('{"name": {{body.user.name | json}}, "missing": {{query.nope | json}}, "page": {{query.page | default "1" | json}}}');
    expect(JSON.parse(out)).toEqual({ name: 'Ada "the" first', missing: null, page: "2" });
  });

  it("helpers", () => {
    expect(render("{{uuid}}")).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(render("{{now}}")))).toBe(false);
    expect(Number(render("{{timestamp}}"))).toBeGreaterThan(1.7e12);
    for (let i = 0; i < 50; i++) {
      const n = Number(render("{{randomInt 1 3}}"));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it("escapes and leaves plain text alone", () => {
    expect(render("literal \\{{params.id}} and }} alone")).toBe("literal {{params.id}} and }} alone");
  });

  it("reports problems with a hint", () => {
    expect(templateProblem("{{params.id}")).toContain("Unclosed {{");
    expect(templateProblem("{{user.id}}")).toContain("Unknown value 'user'");
    expect(templateProblem("{{params.id | shout}}")).toContain("Unknown filter");
    expect(templateProblem('{{params.id | default}}')).toContain("'default' needs 1 argument");
    expect(templateProblem("{{randomInt 1}}")).toContain("'randomInt' needs 2 arguments");
    expect(templateProblem("{{ }}")).toContain("Empty");
    expect(templateProblem("{{method.x}}")).toContain("has no fields");
    expect(templateProblem("{{ 'unterminated }}")).toContain("Unterminated string");
    expect(templateProblem('ok {{params.id | default "x" | upper}}')).toBeUndefined();
  });
});

const tpl = (body: string, headers: Record<string, string> = {}): Scenario => ({ id: "t", name: "T", status: 201, headers, body, tags: [], template: true });

describe("template scenarios", () => {
  it("render body and headers per request; validation sees the rendered body", async () => {
    const { request, history } = await setup([
      {
        id: "users",
        path: "/users/{id}",
        defaultScenario: "t",
        responseSchema: { "2xx": { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
        scenarios: [tpl('{"id": {{params.id | json}}, "name": {{body.name | default "anon" | json}}}', { location: "/users/{{params.id}}", "content-type": "application/json" })],
      },
    ]);
    const res = await request("/users/42", { method: "POST", headers: json, body: '{"name":"Grace"}' });
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/users/42");
    expect(await res.json()).toEqual({ id: "42", name: "Grace" });
    expect(res.headers.get("x-mimic-validation")).toBe("pass");
    expect(history.list()[0]!.response.body).toBe('{"id": "42", "name": "Grace"}');
  });

  it("leaves {{ }} alone when template is off", async () => {
    const { request } = await setup([
      { id: "raw", path: "/raw", defaultScenario: "r", scenarios: [{ id: "r", name: "R", status: 200, headers: {}, body: "{{params.id}}", tags: [] }] },
    ]);
    expect(await (await request("/raw")).text()).toBe("{{params.id}}");
  });

  it("works for the global error scenario too", async () => {
    const { request, store } = await setup([{ id: "errs", path: "/errs", scenarios: [tpl('{"error":"no route for {{method}} {{path}}"}')] }]);
    await store.putSettings({ errorScenario: { service: "errs", scenario: "t" } });
    expect(await (await request("/nowhere", { method: "DELETE" })).text()).toBe('{"error":"no route for DELETE /nowhere"}');
  });

  it("invalid templates are rejected when saved", async () => {
    const { request } = await setup([{ id: "s", path: "/s" }]);
    const put = (body: unknown) => request("/_mimic/api/services/s/scenarios/x", { method: "PUT", headers: json, body: JSON.stringify(body) });
    const bad = await put({ name: "X", template: true, body: "{{nope}}" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Unknown value 'nope'");
    expect((await put({ name: "X", template: true, body: "ok", headers: { h: "{{query.a" } })).status).toBe(400);
    expect((await put({ name: "X", body: "{{nope}}" })).status).toBe(200); // not a template: any text
  });

  it("render API and dashboard preview", async () => {
    const { request } = await setup([{ id: "users", path: "/users/{id}", scenarios: [tpl("hi {{params.id}} {{query.x}} {{body.n}}")] }]);
    const res = await request("/_mimic/api/services/users/scenarios/t/render", { method: "POST", headers: json, body: JSON.stringify({ path: "/users/9?x=1", body: '{"n":5}' }) });
    expect(await res.json()).toMatchObject({ status: 201, body: "hi 9 1 5", params: { id: "9" } });
    expect((await request("/_mimic/api/services/users/scenarios/t/render", { method: "POST", headers: json, body: "{bad" })).status).toBe(400);

    const page = await (await request("/_mimic/services/users")).text();
    expect(page).toContain(">template</span>");
    expect(page).toContain("Preview with a request");
    const preview = await request("/_mimic/ui/services/users/scenarios/t/render", form({ method: "GET", path: "/users/3", body: "" }));
    expect(await preview.text()).toContain("hi 3");
  });

  it("form saves the template flag and shows template errors on the body", async () => {
    const { request, store } = await setup([{ id: "users", path: "/users/{id}" }]);
    let res = await request("/_mimic/services/users/scenarios", form({ id: "t", name: "T", status: "200", body: "{{params.id}}", template: "on" }));
    expect(res.status).toBe(303);
    expect(store.getScenario("users", "t").template).toBe(true);
    expect(await (await request("/_mimic/services/users/scenarios/t/edit")).text()).toMatch(/name="template" checked/);

    res = await request("/_mimic/services/users/scenarios/t", form({ name: "T", status: "200", body: "{{oops}}", template: "on" }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Unknown value &#39;oops&#39;");
    res = await request("/_mimic/services/users/scenarios/t", form({ name: "T", status: "200", body: "{{oops}}" }));
    expect(res.status).toBe(303);
    expect(store.getScenario("users", "t").template).toBeUndefined();
  });
});
