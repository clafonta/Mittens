import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { History, type HistoryEntry } from "../src/core/history.js";
import { HistoryFile } from "../src/core/history-file.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const entry = (n: number): Omit<HistoryEntry, "id"> => ({
  at: new Date(2030, 0, 1, 0, 0, n).toISOString(),
  durationMs: 1,
  source: "scenario",
  request: { method: "GET", url: `http://localhost/r/${n}`, path: `/r/${n}`, headers: {}, body: "", truncated: false },
  response: { status: 200, headers: {}, body: String(n), truncated: false },
});

async function fresh(limit = 5, opts = { gitignore: true }) {
  dir ??= await mkdtemp(path.join(tmpdir(), "mimic-history-"));
  const file = path.join(dir, ".mimic", "history.jsonl");
  const history = new History(limit);
  const persisted = new HistoryFile(file, { ...opts, log: () => {} });
  const result = await persisted.attach(history);
  return { file, history, persisted, result };
}

const lines = async (file: string) => (await readFile(file, "utf8")).split("\n").filter(Boolean);

describe("history persistence", () => {
  it("survives a restart, newest first, and ignores itself in git", async () => {
    const first = await fresh();
    expect(first.result).toEqual({ restored: 0, skipped: 0 });
    for (let i = 1; i <= 3; i++) first.history.add(entry(i));
    await first.persisted.flush();
    expect(await readFile(path.join(path.dirname(first.file), ".gitignore"), "utf8")).toContain("*");

    const second = await fresh();
    expect(second.result.restored).toBe(3);
    expect(second.history.list().map((e) => e.response.body)).toEqual(["3", "2", "1"]);
    expect(second.history.persistedTo).toBe(second.file);
    expect(second.history.get(first.history.list()[0]!.id)).toBeDefined(); // ids are stable, so replay links still work
  });

  it("restores only the newest `limit` entries and compacts the file", async () => {
    const a = await fresh(3);
    for (let i = 1; i <= 5; i++) a.history.add(entry(i));
    await a.persisted.flush();
    expect(await lines(a.file)).toHaveLength(5);
    a.history.add(entry(6)); // 6 lines = 2 × limit → compact to the 3 in memory
    await a.persisted.flush();
    expect((await lines(a.file)).map((l) => (JSON.parse(l) as HistoryEntry).response.body)).toEqual(["4", "5", "6"]);

    const b = await fresh(2);
    expect(b.history.list().map((e) => e.response.body)).toEqual(["6", "5"]);
  });

  it("clearing history empties the file", async () => {
    const a = await fresh();
    a.history.add(entry(1));
    a.history.clear();
    await a.persisted.flush();
    expect(await readFile(a.file, "utf8")).toBe("");
    expect((await fresh()).result.restored).toBe(0);
  });

  it("skips unreadable lines and duplicate ids", async () => {
    const a = await fresh();
    const saved = a.history.add(entry(1));
    await a.persisted.flush();
    const text = await readFile(a.file, "utf8");
    await writeFile(a.file, `${text}{"broken": tru\nnot json\n${JSON.stringify({ hello: "world" })}\n${text}`);
    const b = await fresh();
    expect(b.result).toEqual({ restored: 1, skipped: 3 });
    expect(b.history.list()[0]!.id).toBe(saved.id);
  });

  it("doesn't write a .gitignore for a path you chose", async () => {
    const a = await fresh(5, { gitignore: false });
    expect(existsSync(path.join(path.dirname(a.file), ".gitignore"))).toBe(false);
  });

  it("keeps serving when writes fail, and says so once", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mimic-history-"));
    const file = path.join(dir, "history.jsonl");
    const messages: string[] = [];
    const history = new History(5);
    const persisted = new HistoryFile(file, { log: (m) => messages.push(m) });
    await persisted.attach(history);
    await rm(dir, { recursive: true, force: true }); // the directory disappears under us
    history.add(entry(1));
    history.add(entry(2));
    await persisted.flush();
    expect(history.list()).toHaveLength(2);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Couldn't save history");
  });
});
