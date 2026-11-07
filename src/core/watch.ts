import { watch } from "node:fs";
import type { Hooks } from "./hooks.js";
import type { Store } from "./store.js";

export interface WatchOptions {
  debounceMs?: number;
  log?: (message: string) => void;
  /** Reload service hooks (hook.js etc.) too. */
  hooks?: Hooks;
}

export interface DefinitionsWatcher {
  close(): void;
}

/** YAML files, hook files, and directory renames (which have no extension) are interesting. */
function relevant(filename: string | null): boolean {
  if (!filename) return true;
  const base = filename.split(/[\\/]/).pop() ?? "";
  if (base.startsWith(".")) return false; // temp files from atomic writes, editor swap files
  return base.endsWith(".yaml") || /^hook\.(m?js|m?ts)$/.test(base) || !base.includes(".");
}

/** A code file that isn't itself a hook (a module hooks may import), outside saved history. */
function importedByHooks(filename: string): boolean {
  const parts = filename.split(/[\\/]/);
  const base = parts.at(-1) ?? "";
  if (parts.some((p) => p.startsWith(".") || p === "node_modules")) return false;
  return /\.(m?[jt]s|cjs|cts|json)$/.test(base) && !/^hook\.(m?js|m?ts)$/.test(base);
}

/**
 * Reloads the store when files under `root` change. Events are debounced and
 * reloads never overlap. Only real changes (or errors) are logged, so Mimic's
 * own writes stay quiet.
 */
export function watchDefinitions(root: string, store: Store, opts: WatchOptions = {}): DefinitionsWatcher {
  const debounceMs = opts.debounceMs ?? 150;
  const log = opts.log ?? ((m) => console.log(m));
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let lastError: string | undefined;

  async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const result = await store.reload();
      if (opts.hooks) {
        const changed = await opts.hooks.load(store.listServices().map((s) => s.id));
        for (const id of changed) {
          const hook = opts.hooks.get(id);
          log(hook ? `Loaded hook for '${id}' (${hook.exports.join(", ")})` : `Removed hook for '${id}'`);
        }
      }
      if (result.error) {
        if (result.error !== lastError) log(`Couldn't reload definitions; still serving the last good version.\n${result.error}`);
        lastError = result.error;
      } else {
        if (lastError) log("Definitions are valid again.");
        lastError = undefined;
        if (result.changed) {
          const s = store.listServices().length;
          const p = store.listProfiles().length;
          log(`Reloaded definitions (${s} service${s === 1 ? "" : "s"}, ${p} profile${p === 1 ? "" : "s"})`);
        }
      }
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), debounceMs);
  }

  // Node can't reload a module once imported, so a hook's helper files only change on restart; say so.
  const warned = new Map<string, number>();
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (relevant(filename)) schedule();
    else if (filename && importedByHooks(filename)) {
      const now = Date.now();
      if (now - (warned.get(filename) ?? 0) > 2000) {
        warned.set(filename, now);
        log(`Changed ${filename.split(/[\\/]/).join("/")}: hooks keep using the version they first imported. Restart Mimic to pick it up.`);
      }
    }
  });
  watcher.on("error", (err) => log(`File watching stopped: ${err.message}`));

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}
