import { describe, expect, it } from "vitest";
import { FormError, profileFromForm, scenarioFromForm, scenarioToValues, serviceFromForm } from "../src/ui/form-data.js";
import { fixtures, form, setup } from "./helpers.js";

describe("form parsing", () => {
  it("parses scenario fields, header lines and match rules", () => {
    const input = scenarioFromForm({
      id: "nf",
      name: "Not found",
      status: "404",
      headers: "content-type: application/json\r\n\r\nx-trace: a:b",
      body: "{\r\n}",
      delayMs: "",
      tags: "a, b,,",
      "match.method": "GET",
      "match.params": "id: 404",
      "match.query": "",
      "match.headers": "",
      "match.bodyContains": "",
    });
    expect(input).toEqual({
      id: "nf",
      name: "Not found",
      status: 404,
      headers: { "content-type": "application/json", "x-trace": "a:b" },
      body: "{\n}",
      delayMs: undefined,
      tags: ["a", "b"],
      match: { method: "GET", params: { id: "404" }, query: undefined, headers: undefined, bodyContains: undefined },
    });
  });

  it("omits the match rule when every criterion is blank", () => {
    expect(scenarioFromForm({ id: "a", name: "A", "match.method": "", "match.params": "" }).match).toBeUndefined();
  });

  it("round-trips scenario values", () => {
    const sc = { id: "a", name: "A", status: 201, headers: { a: "1" }, body: "x", delayMs: 5, tags: ["t"], match: { query: { q: "1" } } };
    const back = scenarioFromForm(scenarioToValues(sc));
    expect(back).toMatchObject({ ...sc, match: { query: { q: "1" } } });
  });

  it("reports bad numbers and header lines per field", () => {
    try {
      scenarioFromForm({ id: "a", name: "A", status: "abc", headers: "no colon here" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormError);
      expect((err as FormError).errors).toEqual({ status: "Must be a whole number", headers: 'Line 1: expected "name: value"' });
    }
  });

  it("parses services with defaults", () => {
    expect(serviceFromForm({ id: "a", name: "A", path: "/a", upstream: " ", tags: "" })).toMatchObject({
      method: "ANY",
      mode: "static",
      upstream: undefined,
      delayMs: 0,
      tags: [],
    });
  });

  it("parses profile rows, ignoring unticked services", () => {
    expect(
      profileFromForm({
        id: "p",
        name: "P",
        "svc.users.include": "on",
        "svc.users.mode": "static",
        "svc.users.scenario": "",
        "svc.orders.mode": "proxy",
      }),
    ).toEqual({ id: "p", name: "P", description: "", services: { users: { mode: "static" } } });
  });
});

describe("UI forms", () => {
  it("creates, edits and deletes a service", async () => {
    const { request, store } = await setup([]);
    expect((await request("/_mittens/services/new")).status).toBe(200);

    const created = await request("/_mittens/services", form({ id: "ping", name: "Ping", path: "/ping", method: "GET", mode: "static", delayMs: "0" }));
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toMatch(/^\/_mittens\/services\/ping\?flash=/);
    expect(store.getService("ping").method).toBe("GET");

    const flashed = await (await request(created.headers.get("location")!)).text();
    expect(flashed).toContain("Created service &#39;Ping&#39;");

    const edited = await request(
      "/_mittens/services/ping",
      form({ id: "hacked", name: "Ping 2", path: "/ping2", method: "ANY", mode: "static", delayMs: "10", tags: "x, y" }),
    );
    expect(edited.status).toBe(303);
    expect(store.getService("ping")).toMatchObject({ id: "ping", name: "Ping 2", path: "/ping2", delayMs: 10, tags: ["x", "y"] });

    expect((await request("/_mittens/services/ping/delete", form({}))).status).toBe(303);
    expect(store.listServices()).toEqual([]);
  });

  it("re-renders the form with field errors and keeps the input", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mittens/services", form({ id: "Bad Id", name: "Mine", path: "no-slash", delayMs: "soon" }));
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain('value="Mine"');
    expect(html).toContain("Must be a whole number");

    const res2 = await request("/_mittens/services", form({ id: "Bad Id", name: "Mine", path: "no-slash", delayMs: "0" }));
    const html2 = await res2.text();
    expect(html2).toContain("lowercase letters, digits and dashes only");
    expect(html2).toMatch(/field invalid[^]*f-path/);

    const dup = await request("/_mittens/services", form({ id: "users", name: "Dup", path: "/x" }));
    expect(dup.status).toBe(422);
    expect(await dup.text()).toContain("Service &#39;users&#39; already exists");
  });

  it("puts the 'proxy needs upstream' error on the upstream field", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mittens/services/users", form({ name: "Users", path: "/users/{id}", mode: "proxy", delayMs: "0", upstream: "" }));
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/field invalid[^]*f-upstream[^]*Proxy mode needs an upstream URL/);
  });

  it("creates the first scenario as default, edits and deletes scenarios", async () => {
    const { request, store } = await setup([{ id: "ping", name: "Ping", path: "/ping" }]);
    const created = await request(
      "/_mittens/services/ping/scenarios",
      form({ id: "pong", name: "Pong", status: "201", headers: "content-type: text/plain", body: "pong", "match.query": "q: 1" }),
    );
    expect(created.status).toBe(303);
    expect(store.getService("ping").defaultScenario).toBe("pong");
    const res = await request("/ping");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("pong");

    const dup = await request("/_mittens/services/ping/scenarios", form({ id: "pong", name: "Again" }));
    expect(dup.status).toBe(422);

    expect((await request("/_mittens/services/ping/scenarios/pong/edit")).status).toBe(200);
    await request("/_mittens/services/ping/scenarios/pong", form({ name: "Pong!", status: "200", body: "PONG" }));
    expect(store.getScenario("ping", "pong")).toMatchObject({ name: "Pong!", body: "PONG", match: undefined });

    await request("/_mittens/services/ping/scenarios/pong/delete", form({}));
    expect(store.getService("ping")).toMatchObject({ scenarios: [], defaultScenario: undefined });
  });

  it("creates a profile from the form and applies it from the switcher", async () => {
    const { request, store } = await setup(fixtures());
    const newPage = await (await request("/_mittens/profiles/new")).text();
    expect(newPage).toContain('name="svc.users.include" checked');

    const created = await request(
      "/_mittens/profiles",
      form({ id: "fail", name: "Fail", "svc.users.include": "on", "svc.users.mode": "static", "svc.users.scenario": "boom" }),
    );
    expect(created.status).toBe(303);
    expect(store.getProfile("fail").services).toEqual({ users: { mode: "static", scenario: "boom" } });

    const applied = await request("/_mittens/profiles/apply", form({ id: "fail", return: "/_mittens/services" }));
    expect(applied.status).toBe(303);
    expect(decodeURIComponent(applied.headers.get("location")!)).toBe("/_mittens/services?flash=Applied 'Fail' (1 service changed)");
    expect(store.getService("users")).toMatchObject({ mode: "static", defaultScenario: "boom" });

    const dashboard = await (await request("/_mittens/services")).text();
    expect(dashboard).toMatch(/<option value="fail" selected/);
  });

  it("never redirects outside the dashboard", async () => {
    const { request } = await setup(fixtures(), undefined, [{ id: "p", name: "P", description: "", services: {} }]);
    for (const target of ["https://evil.test", "//evil.test", "/elsewhere"]) {
      const res = await request("/_mittens/profiles/p/apply", form({ return: target }));
      expect(res.headers.get("location")).toMatch(/^\/_mittens\/profiles\?flash=/);
    }
  });

  it("shows a 404 page for unknown services", async () => {
    const { request } = await setup([]);
    expect((await request("/_mittens/services/nope/edit")).status).toBe(404);
  });
});
