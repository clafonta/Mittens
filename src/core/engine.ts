import type { History, HistoryEntry, Source } from "./history.js";
import { upstreamUrl } from "./rewrite.js";
import { validateResponse, type ValidationResult } from "./validate.js";
import { type HookContext, type HookResponse, type Hooks, hookRequest, pickedScenario, runHook, scenarioPick } from "./hooks.js";
import { MatchInput, scoreMatch } from "./match.js";
import { compilePath, matchPath } from "./path.js";
import { renderTemplate } from "./template.js";
import type { Scenario, Service } from "./schema.js";
import type { Store } from "./store.js";

export interface MockRequest {
  method: string;
  /** Absolute URL as received. */
  url: URL;
  headers: Headers;
  body: Uint8Array<ArrayBuffer>;
}

export interface Resolution {
  service?: Service;
  scenario?: Scenario;
  source: Source;
  note?: string;
  status: number;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
  delayMs: number;
}

/** Bodies longer than this are truncated in history (and can't be saved as scenarios). */
export const HISTORY_BODY_LIMIT = 256 * 1024;
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host"];

const enc = new TextEncoder();
const dec = new TextDecoder();

function fromScenario(service: Service, scenario: Scenario, source: Source, note?: string): Resolution {
  return {
    service,
    scenario,
    source,
    note,
    status: scenario.status,
    headers: scenario.headers,
    body: enc.encode(scenario.body),
    delayMs: scenario.delayMs ?? service.delayMs,
  };
}

/** Renders a template scenario's body and header values for a request. */
function renderResolution(res: Resolution, scenario: Scenario, input: MatchInput): Resolution {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) headers[k] = renderTemplate(v, input);
  return { ...res, headers, body: enc.encode(renderTemplate(scenario.body, input)) };
}

/** Turns what a hook returned into response fields. Object bodies become JSON. */
function fromHookResponse(r: HookResponse, base: { status: number; headers: Record<string, string>; delayMs: number }) {
  const headers = { ...(r.headers ?? base.headers) };
  let body: Uint8Array<ArrayBuffer>;
  if (r.body === undefined || r.body === null) body = new Uint8Array();
  else if (typeof r.body === "string") body = enc.encode(r.body);
  else {
    body = enc.encode(JSON.stringify(r.body));
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  }
  const status = Number.isInteger(r.status) && r.status! >= 100 && r.status! <= 599 ? r.status! : base.status;
  const delayMs = typeof r.delayMs === "number" && r.delayMs >= 0 ? r.delayMs : base.delayMs;
  return { status, headers, body, delayMs };
}

function hookFailed(service: Service, err: unknown): Resolution {
  console.error(`[${service.id}] ${err instanceof Error ? err.message : String(err)}`);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.stack : undefined;
  if (cause) console.error(cause);
  return problem(500, err instanceof Error ? err.message : String(err), "error", service);
}

function problem(status: number, message: string, source: Source, service?: Service): Resolution {
  return {
    service,
    source,
    note: message,
    status,
    headers: { "content-type": "application/json" },
    body: enc.encode(JSON.stringify({ mittens: { error: message } }, null, 2)),
    delayMs: service?.delayMs ?? 0,
  };
}

const findScenario = (service: Service, id: string | undefined) =>
  id ? service.scenarios.find((s) => s.id === id) : undefined;

export class Engine {
  constructor(
    private readonly store: Store,
    private readonly history: History,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly hooks?: Hooks,
  ) {}

  /** Resolve, delay, and record a request. */
  async handle(req: MockRequest, opts: { replayOf?: string } = {}): Promise<Resolution & { entry: HistoryEntry; validation?: ValidationResult }> {
    const started = performance.now();
    const res = await this.resolve(req);
    // Mittens's own error responses aren't the service's, so they aren't validated. The full body is checked, even if history truncates it.
    const validation =
      res.service && res.source !== "error" ? validateResponse(res.service.responseSchema, res.status, dec.decode(res.body)) : undefined;
    if (res.delayMs > 0) await new Promise((r) => setTimeout(r, res.delayMs));
    const entry = this.record(req, res, performance.now() - started, opts.replayOf, validation);
    return { ...res, entry, validation };
  }

  /**
   * Sends a recorded request through the current live state again. Returns
   * undefined when the recorded request body was truncated (it can't be
   * reproduced faithfully).
   */
  async replay(original: HistoryEntry): Promise<HistoryEntry | undefined> {
    if (original.request.truncated) return undefined;
    const { entry } = await this.handle(
      {
        method: original.request.method,
        url: new URL(original.request.url),
        headers: new Headers(original.request.headers),
        body: enc.encode(original.request.body),
      },
      { replayOf: original.id },
    );
    return entry;
  }

  /**
   * Picks the response; when Mittens would answer with its own error, the
   * global error scenario (if set) is used instead. Template scenarios are
   * rendered from the request, whichever way they were chosen, and the
   * service's response hook (if any) runs last.
   */
  async resolve(req: MockRequest): Promise<Resolution> {
    const { res, input } = await this.resolveWithFallback(req);
    const rendered = res.scenario?.template ? renderResolution(res, res.scenario, input) : res;
    return this.applyResponseHook(rendered, input);
  }

  private async resolveWithFallback(req: MockRequest): Promise<{ res: Resolution; input: MatchInput }> {
    const { res, input } = await this.resolveOwn(req);
    if (res.source !== "error" && res.source !== "unmatched") return { res, input };
    const global = this.store.globalErrorScenario();
    if (!global) return { res, input };
    const { service: owner, scenario } = global;
    return {
      input,
      res: {
        service: res.service,
        scenario,
        source: "fallback",
        note: `${res.note}; used global error scenario ${owner.id}/${scenario.id}`,
        status: scenario.status,
        headers: scenario.headers,
        body: enc.encode(scenario.body),
        delayMs: scenario.delayMs ?? res.service?.delayMs ?? owner.delayMs,
      },
    };
  }

  private async resolveOwn(req: MockRequest): Promise<{ res: Resolution; input: MatchInput }> {
    const bodyText = dec.decode(req.body);
    const match = this.store.resolve(req.method, req.url.pathname);
    if (!match) {
      const input = new MatchInput(req.method, req.url, req.headers, {}, bodyText);
      const hidden = this.store.resolve(req.method, req.url.pathname, { includeInactive: true });
      const why = hidden ? ` (service '${hidden.service.id}' matches but is outside the tag filter: ${this.store.activeTags.join(", ")})` : "";
      return { res: problem(404, `No service matches ${req.method} ${req.url.pathname}${why}`, "unmatched"), input };
    }
    const input = new MatchInput(req.method, req.url, req.headers, match.params, bodyText);
    const hooked = await this.applyRequestHook(match.service, input);
    return { res: hooked ?? (await this.byMode(match.service, input, req)), input };
  }

  private hookContext(service: Service): HookContext {
    return {
      service,
      scenario: scenarioPick,
      state: this.hooks!.state(service.id),
      shared: this.hooks!.sharedState(),
      live: { mode: service.mode, defaultScenario: service.defaultScenario, delayMs: service.delayMs, modified: this.store.isChoiceModified(service.id) },
      log: (...args: unknown[]) => console.log(`[${service.id}]`, ...args),
    };
  }

  /** The service's request hook: undefined means "carry on as usual". */
  private async applyRequestHook(service: Service, input: MatchInput): Promise<Resolution | undefined> {
    const hook = this.hooks?.get(service.id)?.module.request;
    if (!hook) return undefined;
    let result: unknown;
    try {
      result = await runHook("Request", () => hook(hookRequest(input), this.hookContext(service)));
    } catch (err) {
      return hookFailed(service, err);
    }
    if (result === undefined || result === null) return undefined;
    const picked = pickedScenario(result);
    if (picked !== undefined) {
      const sc = findScenario(service, picked);
      return sc ? fromScenario(service, sc, "scenario", "Chosen by hook") : problem(500, `Hook chose '${picked}', which is not a scenario of '${service.id}'`, "error", service);
    }
    if (typeof result !== "object") return problem(500, `Request hook returned ${typeof result}; return a response object, ctx.scenario(id), or nothing`, "error", service);
    return { ...fromHookResponse(result as HookResponse, { status: 200, headers: {}, delayMs: service.delayMs }), service, source: "hook", note: "Answered by hook" };
  }

  /** The service's response hook, on everything it answered (not on Mittens's own errors). */
  private async applyResponseHook(res: Resolution, input: MatchInput): Promise<Resolution> {
    const service = res.service;
    const hook = service && res.source !== "error" ? this.hooks?.get(service.id)?.module.response : undefined;
    if (!service || !hook) return res;
    const view = { status: res.status, headers: { ...res.headers }, body: dec.decode(res.body) };
    let result: unknown;
    try {
      result = await runHook("Response", () => hook(hookRequest(input), view, this.hookContext(service)));
    } catch (err) {
      return hookFailed(service, err);
    }
    const changes = result !== undefined && result !== null && typeof result === "object" ? (result as HookResponse) : {};
    const next = fromHookResponse({ ...view, ...changes }, { status: res.status, headers: {}, delayMs: res.delayMs });
    const note = [res.note, "changed by response hook"].filter(Boolean).join("; ");
    return { ...res, ...next, note };
  }

  private async byMode(service: Service, input: MatchInput, req: MockRequest): Promise<Resolution> {
    switch (service.mode) {
      case "static": {
        const sc = findScenario(service, service.defaultScenario);
        return sc
          ? fromScenario(service, sc, "scenario")
          : problem(500, `Service '${service.id}' is static but has no default scenario`, "error", service);
      }
      case "dynamic": {
        let best: { sc: Scenario; score: number } | null = null;
        for (const sc of service.scenarios) {
          const score = scoreMatch(sc.match, input);
          if (score !== null && (!best || score > best.score)) best = { sc, score };
        }
        if (best) return fromScenario(service, best.sc, "scenario");
        const fallback = findScenario(service, service.defaultScenario) ?? findScenario(service, service.errorScenario);
        return fallback
          ? fromScenario(service, fallback, "fallback", "No scenario matched; used fallback")
          : problem(404, `No scenario of '${service.id}' matched the request`, "error", service);
      }
      case "proxy":
        return this.proxy(service, req);
    }
  }

  private async proxy(service: Service, req: MockRequest): Promise<Resolution> {
    const target = upstreamUrl(service, req.url);
    if (!target) return problem(500, `Service '${service.id}' has no upstream`, "error", service);
    const headers = new Headers(req.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    headers.delete("content-length");
    // fetch() transparently decodes; ask upstream for identity so recorded bodies stay readable.
    headers.set("accept-encoding", "identity");

    try {
      const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase()) && req.body.byteLength > 0;
      const upstream = await this.fetchImpl(target, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const outHeaders: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        if (!HOP_BY_HOP.includes(k) && k !== "content-encoding" && k !== "content-length") outHeaders[k] = v;
      });
      return {
        service,
        source: "proxy",
        note: `Proxied to ${target}`,
        status: upstream.status,
        headers: outHeaders,
        body: new Uint8Array(await upstream.arrayBuffer()),
        delayMs: service.delayMs,
      };
    } catch (err) {
      const message = `Proxy to ${target} failed: ${describeError(err)}`;
      const sc = findScenario(service, service.errorScenario);
      return sc ? fromScenario(service, sc, "fallback", message) : problem(502, message, "error", service);
    }
  }

  private record(req: MockRequest, res: Resolution, durationMs: number, replayOf?: string, validation?: ValidationResult): HistoryEntry {
    const headersOf = (h: Headers) => Object.fromEntries(h.entries());
    return this.history.add({
      ...(replayOf && { replayOf }),
      ...(validation && { validation }),
      at: new Date().toISOString(),
      durationMs: Math.round(durationMs),
      serviceId: res.service?.id,
      serviceName: res.service?.name,
      scenarioId: res.scenario?.id,
      source: res.source,
      note: res.note,
      request: {
        method: req.method,
        url: req.url.toString(),
        path: req.url.pathname,
        headers: headersOf(req.headers),
        ...preview(req.body),
      },
      response: { status: res.status, headers: res.headers, ...preview(res.body) },
    });
  }
}

function preview(bytes: Uint8Array): { body: string; truncated: boolean } {
  if (bytes.byteLength <= HISTORY_BODY_LIMIT) return { body: dec.decode(bytes), truncated: false };
  return {
    body: dec.decode(bytes.subarray(0, HISTORY_BODY_LIMIT)) + `\n… [truncated, ${bytes.byteLength} bytes total]`,
    truncated: true,
  };
}

/** fetch() wraps the useful detail (ECONNREFUSED, proxy 407, TLS errors) in `cause`. */
function describeError(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err; e && parts.length < 4; e = (e as { cause?: unknown }).cause) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg && !parts.includes(msg)) parts.push(msg);
    if (!(e instanceof Error)) break;
  }
  return parts.join(": ") || "unknown error";
}

/**
 * Renders one scenario for a sample request, for previews. Path params come
 * from the service's route when the sample path matches it.
 */
export function renderScenario(
  service: Service,
  scenario: Scenario,
  sample: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): { status: number; headers: Record<string, string>; body: string; params: Record<string, string> } {
  const url = new URL(sample.path?.trim() || service.path, "http://mittens.local");
  const params = matchPath(compilePath(service.path), url.pathname) ?? {};
  if (!scenario.template) return { status: scenario.status, headers: scenario.headers, body: scenario.body, params };
  const input = new MatchInput((sample.method || "GET").toUpperCase(), url, new Headers(sample.headers ?? {}), params, sample.body ?? "");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(scenario.headers)) headers[k] = renderTemplate(v, input);
  return { status: scenario.status, headers, body: renderTemplate(scenario.body, input), params };
}
