import { describe, expect, it } from "vitest";
import { fixtures, form, json, setup } from "./helpers.js";

describe("live state (store)", () => {
  it("overrides the definition until reset", async () => {
    const { store, request } = await setup(fixtures());
    store.setLiveState("users", { mode: "static", defaultScenario: "boom" });

    expect(store.getService("users")).toMatchObject({ mode: "static", defaultScenario: "boom" });
    expect(store.getDefinition("users")).toMatchObject({ mode: "dynamic", defaultScenario: "ok" });
    expect(store.isModified("users")).toBe(true);
    expect((await request("/users/1")).status).toBe(500);

    expect(store.resetLiveState("users")).toEqual(["users"]);
    expect(store.isModified("users")).toBe(false);
    expect((await request("/users/1")).status).toBe(200);
  });

  it("drops the override when it matches the definition again", async () => {
    const { store } = await setup(fixtures());
    store.setLiveState("users", { mode: "static" });
    store.setLiveState("users", { mode: "dynamic" });
    expect(store.modifiedServiceIds()).toEqual([]);
  });

  it("validates live changes", async () => {
    const { store } = await setup(fixtures());
    expect(() => store.setLiveState("users", { mode: "proxy" })).toThrow(/upstream/);
    expect(() => store.setLiveState("users", { defaultScenario: "ghost" })).toThrow(/ghost/);
    expect(() => store.setLiveState("ghost", { mode: "static" })).toThrow(/not found/);
    expect(store.modifiedServiceIds()).toEqual([]);
  });

  it("editing a starting value takes effect live but keeps other live overrides", async () => {
    const { store } = await setup(fixtures());
    store.setLiveState("orders", { mode: "proxy" });

    // Change only the starting default scenario: live mode (proxy) is kept, live default follows the edit.
    await store.updateService("orders", { defaultScenario: "down" });
    expect(store.getService("orders")).toMatchObject({ mode: "proxy", defaultScenario: "down" });
    expect(store.getDefinition("orders")).toMatchObject({ mode: "static", defaultScenario: "down" });

    // Re-saving the same values is not an edit: live overrides survive.
    await store.updateService("orders", { mode: "static", name: "Orders!" });
    expect(store.getService("orders").mode).toBe("proxy");

    // Removing the upstream makes the live proxy mode impossible: the override is dropped.
    await store.updateService("orders", { upstream: undefined });
    expect(store.getService("orders").mode).toBe("static");
    expect(store.isModified("orders")).toBe(false);
  });

  it("clears a live default scenario when that scenario is deleted", async () => {
    const { store } = await setup(fixtures());
    store.setLiveState("users", { defaultScenario: "boom" });
    await store.deleteScenario("users", "boom");
    expect(store.getService("users").defaultScenario).toBeUndefined();
    expect(store.getDefinition("users").defaultScenario).toBe("ok");
  });

  it("applies profiles to live state only", async () => {
    const { store } = await setup(fixtures(), undefined, [
      { id: "fail", name: "Fail", description: "", services: { users: { mode: "static", scenario: "boom" } } },
    ]);
    store.applyProfile("fail");
    expect(store.getDefinition("users")).toMatchObject({ mode: "dynamic", defaultScenario: "ok" });
    expect(store.isProfileActive(store.getProfile("fail"))).toBe(true);
    store.resetLiveState();
    expect(store.isProfileActive(store.getProfile("fail"))).toBe(false);
  });
});

describe("live state (API)", () => {
  const send = (method: string, v?: unknown) => ({ method, headers: json, body: v === undefined ? undefined : JSON.stringify(v) });

  it("patches, reports, saves and resets live state", async () => {
    const { request, store } = await setup(fixtures());
    const patched = await request("/_mimic/api/state/services/users", send("PATCH", { mode: "static", defaultScenario: "boom" }));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ mode: "static", defaultScenario: "boom" });

    const state = (await (await request("/_mimic/api/state")).json()) as { modified: string[]; services: Record<string, unknown> };
    expect(state.modified).toEqual(["users"]);
    expect(state.services.users).toEqual({
      active: true,
      mode: "static",
      defaultScenario: "boom",
      delayMs: 0,
      modified: true,
      starting: { mode: "dynamic", defaultScenario: "ok", delayMs: 0 },
    });

    // null clears the live default scenario
    await request("/_mimic/api/state/services/users", send("PATCH", { defaultScenario: null }));
    expect(store.getService("users").defaultScenario).toBeUndefined();

    expect(await (await request("/_mimic/api/state/services/users", send("DELETE"))).json()).toEqual({ reset: ["users"] });
    await request("/_mimic/api/state/services/orders", send("PATCH", { defaultScenario: "down" }));
    expect(await (await request("/_mimic/api/state/save", send("POST"))).json()).toEqual({ saved: ["orders"] });
    expect(store.getDefinition("orders").defaultScenario).toBe("down");
    expect(await (await request("/_mimic/api/state", send("DELETE"))).json()).toEqual({ reset: [] });
  });

  it("validates live patches", async () => {
    const { request } = await setup(fixtures());
    expect((await request("/_mimic/api/state/services/users", send("PATCH", { mode: "sideways" }))).status).toBe(400);
    expect((await request("/_mimic/api/state/services/users", send("PATCH", { path: "/x" }))).status).toBe(400);
    expect((await request("/_mimic/api/state/services/users", send("PATCH", { mode: "proxy" }))).status).toBe(409);
    expect((await request("/_mimic/api/state/services/ghost", send("PATCH", { mode: "static" }))).status).toBe(404);
  });

  it("keeps PATCH /services as a definition edit", async () => {
    const { request, store } = await setup(fixtures());
    await request("/_mimic/api/services/users", send("PATCH", { mode: "static" }));
    expect(store.getDefinition("users").mode).toBe("static");
    expect(store.isModified("users")).toBe(false);
  });
});

describe("live state (UI)", () => {
  it("row switcher changes live state, marks the row and signals the banner", async () => {
    const { request, store } = await setup(fixtures());
    const res = await request("/_mimic/ui/services/users", form({ mode: "static", defaultScenario: "boom" }));
    expect(res.headers.get("hx-trigger")).toBe("live-changed");
    expect(await res.text()).toContain("changed");
    expect(store.getDefinition("users").mode).toBe("dynamic");

    const banner = await (await request("/_mimic/ui/live-banner?return=/_mimic")).text();
    expect(banner).toContain("1 service differs from its starting state");

    const dashboard = await (await request("/_mimic/services")).text();
    expect(dashboard).toContain("Save as starting state");

    const reset = await request("/_mimic/ui/services/users/reset", form({}));
    expect(await reset.text()).not.toContain(">changed<");
    expect(store.isModified("users")).toBe(false);
    expect(await (await request("/_mimic/ui/live-banner")).text()).not.toContain("differs");
  });

  it("save and reset buttons redirect back with a message", async () => {
    const { request, store } = await setup(fixtures());
    store.setLiveState("users", { mode: "static" });
    const saved = await request("/_mimic/state/save", form({ return: "/_mimic/services/users" }));
    expect(decodeURIComponent(saved.headers.get("location")!)).toBe("/_mimic/services/users?flash=Saved 1 service as starting state");
    expect(store.getDefinition("users").mode).toBe("static");

    store.setLiveState("users", { mode: "dynamic" });
    const reset = await request("/_mimic/state/reset", form({ return: "https://evil.test" }));
    expect(decodeURIComponent(reset.headers.get("location")!)).toBe("/_mimic/services?flash=Reset 1 service to starting state");
    expect(store.getService("users").mode).toBe("static");
  });

  it("edit form shows starting values, not live ones", async () => {
    const { request, store } = await setup(fixtures());
    store.setLiveState("users", { mode: "static" });
    const html = await (await request("/_mimic/services/users/edit")).text();
    expect(html).toContain("Starting mode");
    expect(html).toMatch(/<option value="dynamic" selected/);
  });
});
