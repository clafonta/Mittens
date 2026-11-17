import { describe, expect, it } from "vitest";
import { fixtures, form, setup } from "./helpers.js";

describe("services table and service bar", () => {
  it("lists each service with its route and scenario count in one cell", async () => {
    const { request } = await setup(fixtures());
    const html = await (await request("/_mittens/services")).text();
    expect(html).toContain('<table class="services">');
    expect(html).toMatch(/class="service-name" href="\/_mittens\/services\/users">Users<\/a>/);
    expect(html).toMatch(/<code class="route">ANY \/users\/\{id\}<\/code> · 2 scenarios/);
    expect(html).not.toContain("<th>Scenarios</th>");
  });

  it("the service page shows a bar, not a link to itself", async () => {
    const { request } = await setup(fixtures());
    const html = await (await request("/_mittens/services/users")).text();
    expect(html).toContain('<div id="svc-users" class="service-bar">');
    expect(html).not.toContain('class="service-name" href="/_mittens/services/users"');
    expect(html).toContain('name="view" value="bar"');
  });

  it("switching re-renders the same view it came from", async () => {
    const { request, store } = await setup(fixtures());
    const bar = await (await request("/_mittens/ui/services/users", form({ mode: "static", defaultScenario: "boom", view: "bar" }))).text();
    expect(bar).toMatch(/^<div id="svc-users" class="service-bar">/);
    expect(bar).toContain(">changed</span>");
    const row = await (await request("/_mittens/ui/services/users", form({ mode: "static", defaultScenario: "ok" }))).text();
    expect(row).toMatch(/^<tr id="svc-users"/);
    const reset = await (await request("/_mittens/ui/services/users/reset", form({ view: "bar" }))).text();
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
    const html = await (await request("/_mittens/services/orders")).text();
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
    expect(await current("/_mittens")).toBeUndefined(); // the home page
    expect(await current("/_mittens/services")).toBe("Services");
    expect(await current("/_mittens/services/users/edit")).toBe("Services");
    expect(await current("/_mittens/import")).toBe("Services");
    expect(await current("/_mittens/profiles/new")).toBe("Profiles");
    expect(await current("/_mittens/history")).toBe("History");
    expect(await current("/_mittens/settings")).toBe("Settings");
    expect(await current("/_mittens/help/scenarios")).toBe("Help");
  });
});

describe("controls", () => {
  it("filters are segmented controls, and the profile picker is one group", async () => {
    const tagged = fixtures();
    tagged[0]!.tags = ["team-a"];
    const { request } = await setup(tagged, undefined, [{ id: "p", name: "P", description: "", services: { users: { mode: "static" } } }]);
    const services = await (await request("/_mittens/services")).text();
    expect(services).toContain('<nav class="segmented" aria-label="Show services by tag">');
    expect(services).toMatch(/<span class="group"><select id="profile-switch"[\s\S]*?<button type="submit">Apply<\/button><\/span>/);
    expect(services).toContain('class="button ghost" href="/_mittens/profiles">Manage</a>');
    const history = await (await request("/_mittens/history?validation=fail")).text();
    expect(history).toMatch(/<nav class="segmented" aria-label="Filter history">[\s\S]*?class="current" aria-current="true" href="\/_mittens\/history\?validation=fail">Schema failures/);
    expect(await (await request("/_mittens/services/new")).text()).toContain('class="button ghost" href="/_mittens/services">Cancel</a>');
  });
});

describe("page shell", () => {
  it("doesn't escape the stylesheet", async () => {
    const { request } = await setup(fixtures());
    const html = await (await request("/_mittens/services")).text();
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    expect(css).toContain(".segmented > a");
    expect(css).toContain('url("data:image/svg+xml');
    expect(css).not.toMatch(/&gt;|&quot;|&#39;/);
  });

  it("has its own icon, so browsers don't request /favicon.ico from the mocks", async () => {
    const { request } = await setup(fixtures());
    expect(await (await request("/_mittens/services")).text()).toContain('<link rel="icon" type="image/svg+xml" href="/_mittens/assets/favicon.svg"/>');
    const icon = await request("/_mittens/assets/favicon.svg");
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(await icon.text()).toMatch(/^<svg/);
  });
});

describe("home page", () => {
  it("is the dashboard root, linked from the Mittens title", async () => {
    const { request } = await setup(fixtures());
    const home = await request("/_mittens");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("<title>Home · Mittens</title>");
    expect(html).toContain('<svg id="flow"');
    expect(html).toMatch(/<a class="brand" href="\/_mittens" aria-current="page">Mittens<\/a>/);
    // Every page links the title home; Services is its own section now.
    const services = await (await request("/_mittens/services")).text();
    expect(services).toMatch(/<a class="brand" href="\/_mittens">Mittens<\/a>/);
    expect(services).toContain('href="/_mittens/services" class="current" aria-current="page">Services</a>');
  });

  it("old service-list links still work", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mittens?tag=checkout", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/_mittens/services?tag=checkout");
  });

  it("deleting a service returns to the services list", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mittens/services/orders/delete", form({}));
    expect(res.headers.get("location")).toMatch(/^\/_mittens\/services\?flash=/);
  });
});
