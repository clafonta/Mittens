import { describe, expect, it } from "vitest";
import { fixtures, form, setup } from "./helpers.js";

describe("services table and service bar", () => {
  it("lists each service with its route and scenario count in one cell", async () => {
    const { request } = await setup(fixtures());
    const html = await (await request("/_mimic/services")).text();
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

describe("header", () => {
  it("marks the current section", async () => {
    const { request } = await setup(fixtures());
    const current = async (path: string) =>
      /<a href="[^"]*" class="(?:nav-help )?current" aria-current="page">([^<]+)<\/a>/.exec(await (await request(path)).text())?.[1];
    expect(await current("/_mimic")).toBeUndefined(); // the home page
    expect(await current("/_mimic/services")).toBe("Services");
    expect(await current("/_mimic/services/users/edit")).toBe("Services");
    expect(await current("/_mimic/import")).toBe("Services");
    expect(await current("/_mimic/profiles/new")).toBe("Profiles");
    expect(await current("/_mimic/history")).toBe("History");
    expect(await current("/_mimic/settings")).toBe("Settings");
    expect(await current("/_mimic/help/scenarios")).toBe("Help");
  });
});

describe("controls", () => {
  it("filters are segmented controls, and the profile picker is one group", async () => {
    const tagged = fixtures();
    tagged[0]!.tags = ["team-a"];
    const { request } = await setup(tagged, undefined, [{ id: "p", name: "P", description: "", services: { users: { mode: "static" } } }]);
    const services = await (await request("/_mimic/services")).text();
    expect(services).toContain('<nav class="segmented" aria-label="Show services by tag">');
    expect(services).toMatch(/<span class="group"><select id="profile-switch"[\s\S]*?<button type="submit">Apply<\/button><\/span>/);
    expect(services).toContain('class="button ghost" href="/_mimic/profiles">Manage</a>');
    const history = await (await request("/_mimic/history?validation=fail")).text();
    expect(history).toMatch(/<nav class="segmented" aria-label="Filter history">[\s\S]*?class="current" aria-current="true" href="\/_mimic\/history\?validation=fail">Schema failures/);
    expect(await (await request("/_mimic/services/new")).text()).toContain('class="button ghost" href="/_mimic/services">Cancel</a>');
  });
});

describe("page shell", () => {
  it("doesn't escape the stylesheet", async () => {
    const { request } = await setup(fixtures());
    const html = await (await request("/_mimic/services")).text();
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(css).toContain(".segmented > a");
    expect(css).toContain('url("data:image/svg+xml');
    expect(css).not.toMatch(/&gt;|&quot;|&#39;/);
  });

  it("has its own icon, so browsers don't request /favicon.ico from the mocks", async () => {
    const { request } = await setup(fixtures());
    expect(await (await request("/_mimic/services")).text()).toContain('<link rel="icon" type="image/svg+xml" href="/_mimic/assets/favicon.svg"/>');
    const icon = await request("/_mimic/assets/favicon.svg");
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(await icon.text()).toMatch(/^<svg/);
  });
});

describe("home page", () => {
  it("is the dashboard root, linked from the Mimic title", async () => {
    const { request } = await setup(fixtures());
    const home = await request("/_mimic");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("<title>Home · Mimic</title>");
    expect(html).toContain("<h1>Homepage</h1>");
    expect(html).toMatch(/<a class="brand" href="\/_mimic" aria-current="page">Mimic<\/a>/);
    // Every page links the title home; Services is its own section now.
    const services = await (await request("/_mimic/services")).text();
    expect(services).toMatch(/<a class="brand" href="\/_mimic">Mimic<\/a>/);
    expect(services).toContain('href="/_mimic/services" class="current" aria-current="page">Services</a>');
  });

  it("old service-list links still work", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mimic?tag=checkout", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/_mimic/services?tag=checkout");
  });

  it("deleting a service returns to the services list", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mimic/services/orders/delete", form({}));
    expect(res.headers.get("location")).toMatch(/^\/_mimic\/services\?flash=/);
  });
});
