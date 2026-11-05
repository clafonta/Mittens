import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { History, HistoryEntry } from "./history.js";

export interface HistoryFileOptions {
  /** Write a `*` .gitignore next to the file so it is never committed. */
  gitignore?: boolean;
  log?: (message: string) => void;
}

const looksLikeEntry = (v: unknown): v is HistoryEntry =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as HistoryEntry).id === "string" &&
  typeof (v as HistoryEntry).at === "string" &&
  typeof (v as HistoryEntry).request === "object" &&
  typeof (v as HistoryEntry).response === "object";

/**
 * Keeps history in a JSON Lines file (oldest first, one entry per line) so it
 * survives restarts. Appends as requests come in; when the file holds twice
 * the history limit it is rewritten with just the entries in memory. Writes
 * are queued, so they never overlap and never slow down a response.
 */
export class HistoryFile {
  private queue: Promise<void> = Promise.resolve();
  private lines = 0;
  private failed = false;
  private readonly log: (message: string) => void;

  constructor(
    readonly file: string,
    private readonly options: HistoryFileOptions = {},
  ) {
    this.log = options.log ?? ((m) => console.error(m));
  }

  /** Loads saved entries into `history` and starts recording to the file. Returns how many were restored. */
  async attach(history: History): Promise<{ restored: number; skipped: number }> {
    const { entries, skipped } = await this.read(history.limit);
    history.restore(entries);
    history.persistedTo = this.file;
    await this.prepare();
    history.on("entry", (entry) => this.enqueue(() => this.append(entry, history)));
    history.on("clear", () =>
      this.enqueue(async () => {
        await writeFile(this.file, "");
        this.lines = 0;
      }),
    );
    return { restored: entries.length, skipped };
  }

  /** Resolves once every queued write has finished. */
  flush(): Promise<void> {
    return this.queue;
  }

  private async read(limit: number): Promise<{ entries: HistoryEntry[]; skipped: number }> {
    if (!existsSync(this.file)) return { entries: [], skipped: 0 };
    const lines = (await readFile(this.file, "utf8")).split("\n").filter((l) => l.trim());
    this.lines = lines.length;
    // Keyed by id: an entry appended while a compaction was queued can appear twice.
    const byId = new Map<string, HistoryEntry>();
    let skipped = 0;
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (looksLikeEntry(parsed)) {
          byId.delete(parsed.id);
          byId.set(parsed.id, parsed);
        }
        else skipped++;
      } catch {
        skipped++; // e.g. a line cut short by a crash
      }
    }
    return { entries: [...byId.values()].slice(-limit).reverse(), skipped };
  }

  private async prepare() {
    const dir = path.dirname(this.file);
    await mkdir(dir, { recursive: true });
    if (this.options.gitignore) {
      const ignore = path.join(dir, ".gitignore");
      if (!existsSync(ignore)) await writeFile(ignore, "# Mimic's request history; may contain credentials.\n*\n");
    }
  }

  private async append(entry: HistoryEntry, history: History) {
    await appendFile(this.file, JSON.stringify(entry) + "\n");
    this.lines++;
    if (this.lines >= history.limit * 2) await this.compact(history);
  }

  private async compact(history: History) {
    const entries = history.list().reverse();
    const tmp = path.join(path.dirname(this.file), `.${path.basename(this.file)}.${randomBytes(4).toString("hex")}.tmp`);
    await writeFile(tmp, entries.map((e) => JSON.stringify(e) + "\n").join(""));
    try {
      await rename(tmp, this.file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    this.lines = entries.length;
  }

  private enqueue(write: () => Promise<void>) {
    this.queue = this.queue.then(write).then(
      () => {
        if (this.failed) this.log(`History is being saved to ${this.file} again.`);
        this.failed = false;
      },
      (err: unknown) => {
        if (!this.failed) this.log(`Couldn't save history to ${this.file}: ${err instanceof Error ? err.message : String(err)}`);
        this.failed = true;
      },
    );
  }
}
