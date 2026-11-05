import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MatchInput } from "./match.js";
import type { Service } from "./schema.js";

// ------------------------------------------------------------- public API

/** The request as hooks see it. Header names are lowercase. */
export interface HookRequest {
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  /** First value of each query parameter; use `url.searchParams` for repeated ones. */
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Raw request body. */
  body: string;
  /** The body parsed as JSON, or undefined if it isn't JSON. */
  json: unknown;
}

/** A response a hook builds or changes. An object body is sent as JSON. */
export interface HookResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | object | null;
  delayMs?: number;
}

export interface HookContext {
  /** The service, in its live state (mode, default scenario). */
  service: Service;
  /** Answer with one of the service's scenarios (templates are rendered as usual). */
  scenario(id: string): HookResult;
  /** Per-service storage that lasts across requests until Mimic restarts. */
  state: Record<string, unknown>;
  /** Write to Mimic's terminal output, prefixed with the service id. */
  log(...args: unknown[]): void;
}

declare const SCENARIO: unique symbol;
/** What `ctx.scenario(id)` returns. */
export type HookResult = { readonly [SCENARIO]: string };

/** Runs before a scenario is chosen. Return nothing for normal behaviour. */
export type RequestHook = (req: HookRequest, ctx: HookContext) => HookResponse | HookResult | undefined | void | Promise<HookResponse | HookResult | undefined | void>;

/** Runs on every response (mocked or proxied); change `res` in place or return a replacement. */
export type ResponseHook = (
  req: HookRequest,
  res: { status: number; headers: Record<string, string>; body: string },
  ctx: HookContext,
) => HookResponse | undefined | void | Promise<HookResponse | undefined | void>;

export interface HookModule {
  request?: RequestHook;
  response?: ResponseHook;
}

// --------------------------------------------------------------- internals

const PICK = Symbol("mimic.scenario");
export const scenarioPick = (id: string) => ({ [PICK]: id }) as unknown as HookResult;
export const pickedScenario = (v: unknown): string | undefined =>
  typeof v === "object" && v !== null && PICK in v ? String((v as Record<symbol, unknown>)[PICK]) : undefined;

export const HOOK_FILES = ["hook.js", "hook.mjs", "hook.ts", "hook.mts"];
export const HOOK_TIMEOUT_MS = 10_000;

export interface LoadedHook {
  file: string;
  /** Path relative to the definitions directory, for display. */
  name: string;
  module: HookModule;
  exports: ("request" | "response")[];
  mtimeMs: number;
}

export class HookError extends Error {}

/** Builds the request view once per request. */
export function hookRequest(input: MatchInput): HookRequest {
  const parsed = input.json();
  return {
    method: input.method.toUpperCase(),
    path: input.url.pathname,
    url: input.url,
    params: { ...input.params },
    query: Object.fromEntries(input.url.searchParams),
    headers: Object.fromEntries(input.headers),
    body: input.bodyText,
    json: parsed.ok ? parsed.value : undefined,
  };
}

/** Runs a hook with a time limit, turning failures into HookError. */
export async function runHook<T>(what: string, fn: () => T | Promise<T>, timeoutMs = HOOK_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HookError(`${what} hook didn't finish within ${timeoutMs / 1000}s`)), timeoutMs);
      }),
    ]);
  } catch (err) {
    if (err instanceof HookError) throw err;
    throw new HookError(`${what} hook threw: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finds and loads `services/<id>/hook.{js,mjs,ts,mts}`. Modules are imported
 * with the file's mtime in the URL, so an edited hook is picked up on reload;
 * a hook that fails to load keeps its last good version and reports the error.
 */
export class Hooks {
  private loaded = new Map<string, LoadedHook>();
  private errors = new Map<string, string>();
  private states = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly root: string | undefined,
    private readonly options: { enabled?: boolean; log?: (m: string) => void } = {},
  ) {}

  get enabled() {
    return this.options.enabled !== false && this.root !== undefined;
  }

  get(serviceId: string): LoadedHook | undefined {
    return this.enabled ? this.loaded.get(serviceId) : undefined;
  }

  error(serviceId: string): string | undefined {
    return this.errors.get(serviceId);
  }

  /** Per-service state shared by that service's hook calls. */
  state(serviceId: string): Record<string, unknown> {
    let s = this.states.get(serviceId);
    if (!s) this.states.set(serviceId, (s = {}));
    return s;
  }

  resetState(serviceId?: string) {
    if (serviceId) this.states.delete(serviceId);
    else this.states.clear();
  }

  /** All hooks currently loaded, and load errors, by service id. */
  summary(): { serviceId: string; file: string; exports: string[]; error?: string }[] {
    const ids = new Set([...this.loaded.keys(), ...this.errors.keys()]);
    return [...ids].sort().map((id) => {
      const h = this.loaded.get(id);
      return { serviceId: id, file: h?.name ?? "", exports: h?.exports ?? [], ...(this.errors.has(id) && { error: this.errors.get(id) }) };
    });
  }

  /** (Re)loads hooks for the given services. Returns ids whose hook changed. */
  async load(serviceIds: string[]): Promise<string[]> {
    if (!this.enabled) return [];
    const changed: string[] = [];
    const wanted = new Set(serviceIds);
    for (const id of [...this.loaded.keys()]) {
      if (!wanted.has(id) || !this.findFile(id)) {
        this.loaded.delete(id);
        this.errors.delete(id);
        changed.push(id);
      }
    }
    for (const id of [...this.errors.keys()]) if (!wanted.has(id) || !this.findFile(id)) this.errors.delete(id);

    for (const id of serviceIds) {
      const file = this.findFile(id);
      if (!file) continue;
      const mtimeMs = statSync(file).mtimeMs;
      const current = this.loaded.get(id);
      if (current && current.file === file && current.mtimeMs === mtimeMs && !this.errors.has(id)) continue;
      try {
        const module = (await import(`${pathToFileURL(file).href}?v=${mtimeMs}`)) as HookModule & { default?: HookModule };
        const mod: HookModule = { request: module.request ?? module.default?.request, response: module.response ?? module.default?.response };
        const exports = (["request", "response"] as const).filter((k) => typeof mod[k] === "function");
        if (exports.length === 0) throw new Error("exports neither a `request` nor a `response` function");
        this.loaded.set(id, { file, name: this.display(file), module: mod, exports, mtimeMs });
        if (this.errors.delete(id)) this.options.log?.(`Hook for '${id}' loads again.`);
        changed.push(id);
      } catch (err) {
        const message = `${this.display(file)}: ${err instanceof Error ? err.message : String(err)}`;
        if (this.errors.get(id) !== message) this.options.log?.(`Couldn't load hook for '${id}'${current ? " (keeping the previous version)" : ""}: ${message}`);
        this.errors.set(id, message);
      }
    }
    return changed;
  }

  /** services/<id>/hook.js, with forward slashes on every platform. */
  private display(file: string) {
    return path.relative(this.root!, file).split(path.sep).join("/");
  }

  private findFile(serviceId: string): string | undefined {
    for (const name of HOOK_FILES) {
      const file = path.join(this.root!, "services", serviceId, name);
      if (existsSync(file)) return file;
    }
    return undefined;
  }
}
