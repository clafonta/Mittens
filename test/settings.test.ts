import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileRepo } from "../src/core/repo.js";
import { Store } from "../src/core/store.js";
import { fixtures, form, json, setup } from "./helpers.js";

const put = (body: unknown) => ({ method: "PUT", headers: json, body: JSON.stringify(body) });
const useGlobal = { errorScenario: { service: "orders", scenario: "down" } };

describe("global error scenario", () => {
  it("is used when no service matches", async () => {
    const { request, store } = await setup(fixtures());
    expect((await request("/nowhere")).status).toBe(404);

    await store.putSettings(useGlobal);
    const res = await request("/nowhere");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("down");
    expect(res.headers.get("x-mimic-source")).toBe("fallback");
    expect(res.headers.get("x-mimic-scenario")).toBe("down");
    expect(res.headers.get("x-mimic-service")).toBeNull();
  });

  it("is used after a service's own fallbacks, never before", async () => {
    const services = fixtures();
    services[0]!.defaultScenario = undefined; // users: dynamic, no default, no error scenario, nothing matches
    const { request, store, history } = await setup(services);
    await store.putSettings(useGlobal);

    const res = await request("/users/1");
    expect(res.status).toBe(503);
    expect(res.headers.get("x-mimic-service")).toBe("users");
    expect(history.list()[0]!.note).toContain("used global error scenario orders/down");

    // A service error scenario wins over the global one.
    await store.updateService("users", { errorScenario: "boom" });
    expect((await request("/users/1")).status).toBe(500);
  });

  it("covers failed proxy calls without a service error scenario", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const services = fixtures();
    const { request, store } = await setup(services, fetchImpl);
    store.setLiveState("orders", { mode: "proxy" });
    expect((await request("/orders")).status).toBe(502);
    await store.putSettings({ errorScenario: { service: "users", scenario: "boom" } });
    const res = await request("/orders");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("boom");
  });

  it("API validates references and reports problems", async () => {
    const { request } = await setup(fixtures());
    const bad = await request("/_mimic/api/settings", put({ errorScenario: { service: "orders", scenario: "nope" } }));
    expect(bad.status).toBe(404);
    const ok = await request("/_mimic/api/settings", put(useGlobal));
    expect(await ok.json()).toEqual({ ...useGlobal, problems: [] });
    expect(await (await request("/_mimic/api/settings")).json()).toEqual({ ...useGlobal, problems: [] });
  });

  it("is cleared when its scenario or service is deleted", async () => {
    const { store } = await setup(fixtures());
    await store.putSettings(useGlobal);
    await store.deleteScenario("orders", "list");
    expect(store.getSettings()).toEqual(useGlobal);
    await store.deleteScenario("orders", "down");
    expect(store.getSettings()).toEqual({});

    await store.putSettings({ errorScenario: { service: "users", scenario: "boom" } });
    await store.deleteService("users");
    expect(store.getSettings()).toEqual({});
  });

  it("dashboard settings page saves and clears the selection", async () => {
    const { request, store } = await setup(fixtures());
    const html = await (await request("/_mimic/settings")).text();
    expect(html).toContain('<optgroup label="Orders">');
    expect(html).toContain('value="orders/down"');

    let res = await request("/_mimic/settings", form({ errorScenario: "orders/down" }));
    expect(res.status).toBe(303);
    expect(store.getSettings()).toEqual(useGlobal);
    expect(await (await request("/_mimic/services/orders")).text()).toContain("global error");

    res = await request("/_mimic/settings", form({ errorScenario: "orders/ghost" }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("&#39;ghost&#39; is not a scenario of &#39;orders&#39;");

    await request("/_mimic/settings", form({ errorScenario: "" }));
    expect(store.getSettings()).toEqual({});
  });

  it("is stored in mimic.yaml, removed when empty, and a dangling reference is ignored", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mimic-settings-"));
    try {
      const store = new Store(new FileRepo(dir));
      await store.load();
      await store.createService({ id: "errs", name: "Errors", path: "/errs", scenarios: [{ id: "e500", name: "500", status: 500 }] });
      await store.putSettings({ errorScenario: { service: "errs", scenario: "e500" } });
      const file = path.join(dir, "mimic.yaml");
      expect(await readFile(file, "utf8")).toBe("errorScenario:\n  service: errs\n  scenario: e500\n");

      await writeFile(file, "errorScenario:\n  service: errs\n  scenario: gone\n");
      expect((await store.reload()).changed).toBe(true);
      expect(store.settingsProblems()).toEqual(["Global error scenario: 'gone' is not a scenario of 'errs'"]);
      expect(store.globalErrorScenario()).toBeUndefined();

      await store.putSettings({});
      expect(existsSync(file)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
