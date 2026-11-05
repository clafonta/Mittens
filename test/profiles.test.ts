import { describe, expect, it } from "vitest";
import { fixtures, json, setup } from "./helpers.js";

const outage = {
  id: "outage",
  name: "Outage",
  description: "",
  services: { users: { mode: "static" as const, scenario: "boom" }, orders: { scenario: "down" } },
};

describe("profiles (store)", () => {
  it("applies mode and scenario to listed services only", async () => {
    const { store, request } = await setup(fixtures(), undefined, [outage]);
    expect(store.isProfileActive(store.getProfile("outage"))).toBe(false);

    const changed = store.applyProfile("outage");
    expect(changed.map((s) => s.id).sort()).toEqual(["orders", "users"]);
    expect(store.getService("users")).toMatchObject({ mode: "static", defaultScenario: "boom" });
    // mode not given → unchanged
    expect(store.getService("orders")).toMatchObject({ mode: "static", defaultScenario: "down" });
    expect(store.isProfileActive(store.getProfile("outage"))).toBe(true);
    expect((await request("/users/1")).status).toBe(500);

    // re-applying changes nothing
    expect(store.applyProfile("outage")).toEqual([]);
    // a manual change makes it inactive again
    store.setLiveState("users", { mode: "dynamic" });
    expect(store.isProfileActive(store.getProfile("outage"))).toBe(false);
  });

  it("is all-or-nothing when the profile is stale", async () => {
    const stale = { ...outage, services: { ...outage.services, ghost: { mode: "static" as const } } };
    const { store } = await setup(fixtures(), undefined, [stale]);
    expect(store.profileProblems(store.getProfile("outage"))).toEqual(["Service 'ghost' does not exist"]);
    expect(() => store.applyProfile("outage")).toThrow(/ghost/);
    expect(store.getService("users")).toMatchObject({ mode: "dynamic", defaultScenario: "ok" });
  });

  it("flags missing scenarios and proxy without upstream", async () => {
    const bad = { id: "bad", name: "Bad", description: "", services: { users: { mode: "proxy" as const, scenario: "nope" } } };
    const { store } = await setup(fixtures(), undefined, [bad]);
    expect(store.profileProblems(store.getProfile("bad"))).toEqual([
      "Scenario 'nope' does not exist in 'users'",
      "'users' has no upstream for proxy mode",
    ]);
  });

  it("reports current settings for snapshots", async () => {
    const { store } = await setup(fixtures());
    expect(store.currentSettings()).toEqual({
      users: { mode: "dynamic", scenario: "ok" },
      orders: { mode: "static", scenario: "list" },
    });
  });
});

describe("profiles (API)", () => {
  const send = (method: string, v: unknown) => ({ method, headers: json, body: JSON.stringify(v) });

  it("creates from current state, lists with status, applies and deletes", async () => {
    const { request } = await setup(fixtures());
    const created = await request("/_mimic/api/profiles?from=current", send("POST", { id: "now", name: "Now" }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: "now", active: true, problems: [], services: { users: { mode: "dynamic" } } });

    expect((await request("/_mimic/api/profiles", send("POST", { id: "now", name: "Again" }))).status).toBe(409);

    const put = await request("/_mimic/api/profiles/now", send("PUT", { name: "Now", services: { users: { scenario: "boom" } } }));
    expect(await put.json()).toMatchObject({ active: false });

    const applied = await request("/_mimic/api/profiles/now/apply", { method: "POST" });
    expect(await applied.json()).toEqual({ applied: "now", changed: ["users"] });
    expect(await (await request("/users/1")).text()).toBe("boom");

    expect((await request("/_mimic/api/profiles/now", { method: "DELETE" })).status).toBe(204);
    expect((await request("/_mimic/api/profiles/now")).status).toBe(404);
  });

  it("rejects applying a broken profile with 409", async () => {
    const { request } = await setup(fixtures(), undefined, [
      { id: "x", name: "X", description: "", services: { ghost: { mode: "static" } } },
    ]);
    const res = await request("/_mimic/api/profiles/x/apply", { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("ghost");
  });

  it("validates profile bodies", async () => {
    const { request } = await setup(fixtures());
    const res = await request("/_mimic/api/profiles", send("POST", { id: "x", name: "X", services: { users: { mode: "sideways" } } }));
    expect(res.status).toBe(400);
  });
});
