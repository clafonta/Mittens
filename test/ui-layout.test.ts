import { describe, expect, it } from "vitest";
import { fixtures, form, setup } from "./helpers.js";

describe("services table and service bar", () => {
  it("lists each service with its route and scenario count in one cell", async () => {
    const { request } = await setup(fixtures());
    const html = await (await request("/_mimic")).text();
    expect(html).toContain('<table class="services">');
    expect(html).toMatch(/class="service-name" href="\/_mimic\/services\/users">Users<\/a>/);
    expect(html).toMatch(/<code class="route">ANY \/users\/\{id\}<\/code> · 2 scenarios/);
    expect(html).not.toContain("<th>Scenarios</th>");
  });

  it("the service page shows a bar, not a link to itself", async () => {
    const { request } = await setup(fixtures());
    const html = await (await request("/_mimic/services/users")).text();
    expect(html).toContain('<div id="svc-users" class="service-bar">');
    expect(html).not.toContain('class="service-name" href="/_mimic/services/users"');
    expect(html).toContain('name="view" value="bar"');
  });

  it("switching re-renders the same view it came from", async () => {
    const { request, store } = await setup(fixtures());
    const bar = await (await request("/_mimic/ui/services/users", form({ mode: "static", defaultScenario: "boom", view: "bar" }))).text();
    expect(bar).toMatch(/^<div id="svc-users" class="service-bar">/);
    expect(bar).toContain(">changed</span>");
    const row = await (await request("/_mimic/ui/services/users", form({ mode: "static", defaultScenario: "ok" }))).text();
    expect(row).toMatch(/^<tr id="svc-users"/);
    const reset = await (await request("/_mimic/ui/services/users/reset", form({ view: "bar" }))).text();
    expect(reset).toMatch(/^<div id="svc-users" class="service-bar">/);
    expect(store.isModified("users")).toBe(false);
  });
});

describe("match rule summary", () => {
  it("shows rules as readable chips in the form's syntax", async () => {
    const { request } = await setup([
      {
        id: "orders",
        path: "/orders/{id}",
        mode: "dynamic",
        scenarios: [
          {
            id: "vip",
            name: "VIP",
            status: 200,
            headers: {},
            body: "",
            tags: [],
            match: {
              method: "POST",
              params: { id: { regex: "^9\\d+$" } },
              query: { verbose: "true" },
              headers: { "x-tenant": "acme" },
              bodyContains: "gold",
              bodyMatches: { regex: "refund", flags: "i" },
              json: { "$.user.role": "admin", "$.coupon": { exists: true } },
            },
          },
        ],
      },
    ]);
    const html = await (await request("/_mimic/services/orders")).text();
    const chips = [...html.matchAll(/<code class="chip">([^<]*)<\/code>/g)].map((m) => m[1]);
    expect(chips).toEqual([
      "method POST",
      "param id ~ ^9\\d+$",
      "query verbose: true",
      "header x-tenant: acme",
      "body contains &quot;gold&quot;",
      "body ~i refund",
      "$.user.role = admin",
      "$.coupon exists",
    ]);
    expect(html).not.toContain("match: {");
  });
});
