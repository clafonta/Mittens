import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRepo, LoadError } from "../src/core/repo.js";
import { Store } from "../src/core/store.js";
import { EXAMPLE_SERVICES, init } from "../src/init.js";

let dir: string;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("FileRepo", () => {
  it("round-trips the example definitions", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-"));
    expect((await init(dir)).created).toBe(true);
    expect((await init(dir)).created).toBe(false);

    const loaded = await new FileRepo(dir).loadAll();
    expect(loaded.map((s) => s.id).sort()).toEqual(EXAMPLE_SERVICES.map((s) => s.id).sort());
    const users = loaded.find((s) => s.id === "users")!;
    const expected = EXAMPLE_SERVICES.find((s) => s.id === "users")!;
    expect(users).toEqual({ ...expected, scenarios: [...expected.scenarios].sort((a, b) => a.id.localeCompare(b.id)) });
  });

  it("writes bodies as readable YAML block scalars", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-"));
    await init(dir);
    const text = await readFile(path.join(dir, "services/users/scenarios/found.yaml"), "utf8");
    expect(text).toContain("body: |");
    expect(text).toContain('"name": "Ada Lovelace"');
  });

  it("persists definition changes and honours read-only", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-"));
    await init(dir);
    const store = new Store(new FileRepo(dir));
    await store.load();
    await store.updateService("users", { mode: "static" });
    await store.deleteScenario("users", "not-found");

    const reloaded = new Store(new FileRepo(dir));
    await reloaded.load();
    expect(reloaded.getService("users").mode).toBe("static");
    expect(reloaded.getService("users").scenarios.map((s) => s.id)).not.toContain("not-found");

    const ro = new Store(new FileRepo(dir), { readOnly: true });
    await ro.load();
    await ro.updateService("users", { mode: "dynamic" });
    const again = new Store(new FileRepo(dir));
    await again.load();
    expect(again.getService("users").mode).toBe("static");
  });

  it("never writes live state, profiles applied, or scenario edits' live view to disk", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-"));
    await init(dir);
    const file = path.join(dir, "services/users/service.yaml");
    const original = await readFile(file, "utf8");

    const store = new Store(new FileRepo(dir));
    await store.load();
    store.setLiveState("users", { mode: "static", defaultScenario: "server-error" });
    store.applyProfile("outage");
    // Editing a scenario rewrites only the scenario file, never the live mode into service.yaml.
    await store.putScenario("users", { ...store.getScenario("users", "found"), body: "changed" });
    expect(await readFile(file, "utf8")).toBe(original);

    const reloaded = new Store(new FileRepo(dir));
    await reloaded.load();
    expect(reloaded.getService("users")).toMatchObject({ mode: "dynamic", defaultScenario: "found" });

    // ...until saved on purpose.
    expect(await store.saveLiveState()).toEqual(["users"]);
    expect(await readFile(file, "utf8")).toContain("mode: static");
    expect(await readFile(file, "utf8")).toContain("defaultScenario: server-error");
    expect(store.modifiedServiceIds()).toEqual([]);
  });

  it("reports the offending file for invalid definitions", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mittens-"));
    await init(dir);
    await writeFile(path.join(dir, "services/users/service.yaml"), "name: Users\npath: no-slash\n");
    const err = await new FileRepo(dir).loadAll().catch((e) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect(err.message).toContain("services/users/service.yaml");
  });
});
