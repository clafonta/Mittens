import { describe, expect, it } from "vitest";
import { form, json, setup, type ServiceInput } from "./helpers.js";

const services = (): ServiceInput[] => [
  {
    id: "cart",
    name: "Cart",
    path: "/cart",
    tags: ["Checkout"],
    defaultScenario: "ok",
    scenarios: [{ id: "ok", name: "OK", status: 200, headers: {}, body: "cart", tags: [] }],
  },
  {
    id: "auth",
    name: "Auth",
    path: "/auth",
    defaultScenario: "ok",
    // Tagged only on a scenario: still counts as a "checkout" service.
    scenarios: [{ id: "ok", name: "OK", status: 200, headers: {}, body: "auth", tags: ["checkout"] }],
  },
  {
    id: "search",
    name: "Search",
    path: "/search",
    tags: ["catalog"],
    defaultScenario: "ok",
    scenarios: [{ id: "ok", name: "OK", status: 200, headers: {}, body: "search", tags: [] }],
  },
];

const put = (body: unknown) => ({ method: "PUT", headers: json, body: JSON.stringify(body) });

describe("tags", () => {
  it("collects tags from services and scenarios, lowercased", async () => {
    const { request } = await setup(services());
    expect(await (await request("/_mimic/api/tags")).json()).toEqual({ tags: ["catalog", "checkout"], active: [] });
  });

  it("filters the service list by tag", async () => {
    const { request } = await setup(services());
    const listed = (await (await request("/_mimic/api/services?tag=checkout")).json()) as { id: string }[];
    expect(listed.map((s) => s.id)).toEqual(["auth", "cart"]);
    const either = (await (await request("/_mimic/api/services?tag=catalog&tag=checkout")).json()) as unknown[];
    expect(either).toHaveLength(3);
  });

  it("limits which services answer requests", async () => {
    const { request, store } = await setup(services());
    const res = await request("/_mimic/api/state/tags", put({ tags: ["CHECKOUT"] }));
    expect(await res.json()).toEqual({ tags: ["checkout"], active: ["auth", "cart"] });

    expect(await (await request("/cart")).text()).toBe("cart");
    expect(await (await request("/auth")).text()).toBe("auth");
    const hidden = await request("/search");
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("x-mimic-source")).toBe("unmatched");
    expect(await hidden.text()).toContain("'search' matches but is outside the tag filter: checkout");

    const state = (await (await request("/_mimic/api/state")).json()) as { tags: string[]; services: Record<string, { active: boolean }> };
    expect(state.tags).toEqual(["checkout"]);
    expect(state.services.search!.active).toBe(false);

    await request("/_mimic/api/state/tags", put({ tags: [] }));
    expect(store.activeTags).toEqual([]);
    expect((await request("/search")).status).toBe(200);
  });

  it("falls through to a less specific active service", async () => {
    const { request, store } = await setup([
      { id: "catchall", path: "/api/*", tags: ["base"], defaultScenario: "x", scenarios: [{ id: "x", name: "X", status: 200, headers: {}, body: "catchall", tags: [] }] },
      { id: "users", path: "/api/users", tags: ["users"], defaultScenario: "x", scenarios: [{ id: "x", name: "X", status: 200, headers: {}, body: "users", tags: [] }] },
    ]);
    expect(await (await request("/api/users")).text()).toBe("users");
    store.setActiveTags(["base"]);
    expect(await (await request("/api/users")).text()).toBe("catchall");
  });

  it("dashboard: chips filter the table, and a tag can become the serving filter", async () => {
    const { request, store } = await setup(services());
    const all = await (await request("/_mimic/services")).text();
    expect(all).toContain('href="/_mimic/services?tag=checkout"');
    expect(all).not.toContain("Only serving");

    const filtered = await (await request("/_mimic/services?tag=checkout")).text();
    expect(filtered).toContain("Cart");
    expect(filtered).not.toContain(">Search</a>");
    expect(filtered).toContain("Only serve “checkout”");

    const res = await request("/_mimic/state/tags", form({ tags: "checkout", return: "/_mimic/services?tag=checkout" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/_mimic/services?tag=checkout&flash=");
    expect(store.activeTags).toEqual(["checkout"]);

    const page = await (await request("/_mimic/services")).text();
    expect(page).toContain("Only serving services tagged <strong>checkout</strong>");
    expect(page).toContain("1 service is not answering requests");
    expect(page).toContain('class="inactive"');
    expect(page).toContain("not serving");

    await request("/_mimic/state/tags", form({ tags: "", return: "/_mimic/services" }));
    expect(store.activeTags).toEqual([]);
  });

  it("empty filter result explains itself", async () => {
    const { request } = await setup(services());
    expect(await (await request("/_mimic/services?tag=nope")).text()).toContain("No services tagged “nope”");
  });
});
