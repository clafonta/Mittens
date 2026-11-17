import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRepo } from "../src/core/repo.js";
import { Store } from "../src/core/store.js";
import { type DefinitionsWatcher, watchDefinitions } from "../src/core/watch.js";
import { init } from "../src/init.js";

let dir: string | undefined;
let watcher: DefinitionsWatcher | undefined;
afterEach(async () => {
  watcher?.close();
  watcher = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function fresh() {
  dir = await mkdtemp(path.join(tmpdir(), "mittens-watch-"));
  await init(dir);
  const store = new Store(new FileRepo(dir));
  await store.load();
  return { dir, store };
}

async function waitFor(check: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** fs.watch has no "ready" signal; on macOS FSEvents can miss writes made in the first moments. */
const settle = () => new Promise((r) => setTimeout(r, 250));

const usersYaml = (root: string) => path.join(root, "services/users/service.yaml");

describe("Store.reload", () => {
  it("picks up edits and reports whether anything changed", async () => {
    const { dir, store } = await fresh();
    expect(await store.reload()).toEqual({ changed: false });

    const yaml = (await readFile(usersYaml(dir), "utf8")).replace("name: Users API", "name: People API");
    await writeFile(usersYaml(dir), yaml);
    expect(await store.reload()).toEqual({ changed: true });
    expect(store.getService("users").name).toBe("People API");
  });

  it("keeps live state that still makes sense and drops the rest", async () => {
    const { dir, store } = await fresh();
    store.setLiveState("users", { mode: "static", defaultScenario: "not-found" });
    store.applyProfile("happy-path"); // users → dynamic/found: back to definition, no override
    store.setLiveState("users", { defaultScenario: "not-found" });
    store.setLiveState("httpbin", { mode: "static" });

    // Delete the scenario the live state points at; httpbin's override stays valid.
    await rm(path.join(dir, "services/users/scenarios/not-found.yaml"));
    await store.reload();
    expect(store.isModified("users")).toBe(false);
    expect(store.getService("httpbin").mode).toBe("static");
  });

  it("keeps serving the last good definitions when a file is invalid", async () => {
    const { dir, store } = await fresh();
    await writeFile(usersYaml(dir), "name: Users\npath: [oops\n");
    const result = await store.reload();
    expect(result.changed).toBe(false);
    expect(result.error).toContain("services/users/service.yaml");
    expect(store.reloadError).toBe(result.error);
    expect(store.getService("users").path).toBe("/api/users/{id}");

    await writeFile(usersYaml(dir), "name: Users\npath: /u/{id}\n");
    expect((await store.reload()).changed).toBe(true);
    expect(store.reloadError).toBeUndefined();
  });

  it("picks up services and profiles added or removed on disk", async () => {
    const { dir, store } = await fresh();
    await writeFile(path.join(dir, "profiles/empty.yaml"), "name: Empty\n");
    await rm(path.join(dir, "services/httpbin"), { recursive: true });
    await store.reload();
    expect(store.listProfiles().map((p) => p.id)).toContain("empty");
    expect(store.listServices().map((s) => s.id)).toEqual(["users"]);
  });
});

describe("atomic writes", () => {
  it("leaves no temp files behind", async () => {
    const { dir, store } = await fresh();
    await store.updateService("users", { description: "changed" });
    const files = await readdir(path.join(dir, "services/users"));
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("watchDefinitions", () => {
  it("reloads after an external edit and logs once", async () => {
    const { dir, store } = await fresh();
    const logs: string[] = [];
    watcher = watchDefinitions(dir, store, { debounceMs: 30, log: (m) => logs.push(m) });
    await settle();

    const yaml = (await readFile(usersYaml(dir), "utf8")).replace("name: Users API", "name: Edited");
    await writeFile(usersYaml(dir), yaml);
    await waitFor(() => store.getService("users").name === "Edited");
    await waitFor(() => logs.length > 0);
    expect(logs).toEqual(["Reloaded definitions (2 services, 2 profiles)"]);
  });

  it("stays quiet about Mittens's own writes", async () => {
    const { dir, store } = await fresh();
    const logs: string[] = [];
    watcher = watchDefinitions(dir, store, { debounceMs: 30, log: (m) => logs.push(m) });
    await settle();
    await store.updateService("users", { description: "from the dashboard" });
    await new Promise((r) => setTimeout(r, 300));
    expect(logs).toEqual([]);
    expect(store.getService("users").description).toBe("from the dashboard");
  });

  it("reports an invalid edit once, then recovery", async () => {
    const { dir, store } = await fresh();
    const logs: string[] = [];
    watcher = watchDefinitions(dir, store, { debounceMs: 30, log: (m) => logs.push(m) });
    await settle();

    await writeFile(usersYaml(dir), "name: Users\npath: no-slash\n");
    await waitFor(() => store.reloadError !== undefined);
    await writeFile(usersYaml(dir), "name: Users\npath: still-no-slash\n");
    await new Promise((r) => setTimeout(r, 200));
    await writeFile(usersYaml(dir), "name: Fixed\npath: /fixed\n");
    await waitFor(() => store.getService("users").name === "Fixed");
    await waitFor(() => logs.some((l) => l.startsWith("Reloaded")));

    expect(logs[0]).toContain("Couldn't reload definitions");
    expect(logs.filter((l) => l.startsWith("Couldn't")).length).toBe(1);
    expect(logs).toContain("Definitions are valid again.");
  });
});

describe("watching hooks", () => {
  it("loads a hook file when it is saved", async () => {
    const { dir: root, store } = await fresh();
    const { Hooks } = await import("../src/core/hooks.js");
    const hooks = new Hooks(root);
    await hooks.load(store.listServices().map((s) => s.id));
    const logs: string[] = [];
    watcher = watchDefinitions(root, store, { debounceMs: 30, log: (m) => logs.push(m), hooks });
    await settle();
    await writeFile(path.join(root, "services/users/hook.js"), "export const request = () => ({ body: 'hooked' });\n");
    await waitFor(() => logs.some((l) => l.includes("Loaded hook for 'users' (request)")));
    expect(hooks.get("users")?.exports).toEqual(["request"]);
  });
});
