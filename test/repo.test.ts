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
    dir = await mkdtemp(path.join(tmpdir(), "mimic-"));
    expect((await init(dir)).created).toBe(true);
    expect((await init(dir)).created).toBe(false);

    const loaded = await new FileRepo(dir).loadAll();
    expect(loaded.map((s) => s.id).sort()).toEqual(EXAMPLE_SERVICES.map((s) => s.id).sort());
    const users = loaded.find((s) => s.id === "users")!;
    const expected = EXAMPLE_SERVICES.find((s) => s.id === "users")!;
    expect(users).toEqual({ ...expected, scenarios: [...expected.scenarios].sort((a, b) => a.id.localeCompare(b.id)) });
  });

  it("writes bodies as readable YAML block scalars", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-"));
    await init(dir);
    const text = await readFile(path.join(dir, "services/users/scenarios/found.yaml"), "utf8");
    expect(text).toContain("body: |");
    expect(text).toContain('"name": "Ada Lovelace"');
  });

  it("persists store changes and honours read-only", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-"));
    await init(dir);
    const store = new Store(new FileRepo(dir));
    await store.load();
    await store.setMode("users", "static");
    await store.deleteScenario("users", "not-found");

    const reloaded = new Store(new FileRepo(dir));
    await reloaded.load();
    expect(reloaded.getService("users").mode).toBe("static");
    expect(reloaded.getService("users").scenarios.map((s) => s.id)).not.toContain("not-found");

    const ro = new Store(new FileRepo(dir), { readOnly: true });
    await ro.load();
    await ro.setMode("users", "dynamic");
    const again = new Store(new FileRepo(dir));
    await again.load();
    expect(again.getService("users").mode).toBe("static");
  });

  it("reports the offending file for invalid definitions", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-"));
    await init(dir);
    await writeFile(path.join(dir, "services/users/service.yaml"), "name: Users\npath: no-slash\n");
    const err = await new FileRepo(dir).loadAll().catch((e) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect(err.message).toContain("services/users/service.yaml");
  });
});
