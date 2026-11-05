import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

const body = (v: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });

describe("management API", () => {
  it("creates a service and scenario, then serves it", async () => {
    const { request } = await setup([]);
    expect((await request("/_mimic/api/services", body({ id: "ping", name: "Ping", path: "/ping" }))).status).toBe(201);

    const put = await request("/_mimic/api/services/ping/scenarios/pong", {
      ...body({ name: "Pong", body: "pong" }),
      method: "PUT",
    });
    expect(put.status).toBe(200);

    const patch = await request("/_mimic/api/services/ping", { ...body({ defaultScenario: "pong" }), method: "PATCH" });
    expect(patch.status).toBe(200);

    expect(await (await request("/ping")).text()).toBe("pong");
  });

  it("validates input", async () => {
    const { request } = await setup([]);
    const res = await request("/_mimic/api/services", body({ id: "Bad Id", path: "nope" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  it("rejects unknown default scenarios and duplicate ids", async () => {
    const { request } = await setup([{ id: "a", path: "/a" }]);
    expect((await request("/_mimic/api/services", body({ id: "a", name: "A", path: "/a" }))).status).toBe(409);
    expect((await request("/_mimic/api/services/a", { ...body({ defaultScenario: "ghost" }), method: "PATCH" })).status).toBe(404);
    expect((await request("/_mimic/api/services/zzz")).status).toBe(404);
  });

  it("reserves ids that collide with dashboard routes", async () => {
    const { request } = await setup([]);
    expect((await request("/_mimic/api/services", body({ id: "new", name: "N", path: "/n" }))).status).toBe(409);
    expect((await request("/_mimic/api/profiles", body({ id: "apply", name: "A" }))).status).toBe(409);
  });

  it("requires an upstream for proxy mode", async () => {
    const { request } = await setup([{ id: "a", path: "/a" }]);
    expect((await request("/_mimic/api/services/a", { ...body({ mode: "proxy" }), method: "PATCH" })).status).toBe(409);
  });

  it("exposes and clears history", async () => {
    const { request } = await setup([]);
    await request("/whatever");
    const list = (await (await request("/_mimic/api/history")).json()) as { id: string }[];
    expect(list).toHaveLength(1);
    expect((await request(`/_mimic/api/history/${list[0]!.id}`)).status).toBe(200);
    expect((await request("/_mimic/api/history", { method: "DELETE" })).status).toBe(204);
    expect(await (await request("/_mimic/api/history")).json()).toEqual([]);
  });

  it("does not record its own API/UI traffic as mock traffic", async () => {
    const { request, history } = await setup([]);
    await request("/_mimic");
    await request("/_mimic/api/services");
    await request("/_mimic/does-not-exist");
    expect(history.list()).toHaveLength(0);
  });
});

describe("UI", () => {
  it("renders the dashboard and switches mode via the htmx endpoint", async () => {
    const { request, store } = await setup([
      { id: "a", name: "Alpha", path: "/a", scenarios: [{ id: "x", name: "X", status: 200, headers: {}, body: "", tags: [] }] },
    ]);
    const html = await (await request("/_mimic")).text();
    expect(html).toContain("Alpha");
    expect(html).toContain("/_mimic/assets/htmx.min.js");
    expect((await request("/_mimic/assets/htmx.min.js")).status).toBe(200);

    const res = await request("/_mimic/ui/services/a", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "mode=dynamic&defaultScenario=x",
    });
    expect(res.status).toBe(200);
    expect(store.getService("a")).toMatchObject({ mode: "dynamic", defaultScenario: "x" });
  });
});
