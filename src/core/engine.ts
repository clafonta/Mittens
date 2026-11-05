import type { History, HistoryEntry, Source } from "./history.js";
import { upstreamUrl } from "./rewrite.js";
import type { MatchRule, Scenario, Service } from "./schema.js";
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

/** Score a scenario's match rule; null = does not match. Higher = more specific. */
export function scoreMatch(rule: MatchRule | undefined, req: MockRequest, params: Record<string, string>, bodyText: string): number | null {
  if (!rule) return null;
  let score = 0;
  const check = (ok: boolean) => {
    if (!ok) return false;
    score += 1;
    return true;
  };

  if (rule.method && rule.method !== "ANY" && !check(rule.method === req.method.toUpperCase())) return null;
  for (const [k, v] of Object.entries(rule.params ?? {})) if (!check(params[k] === v)) return null;
  for (const [k, v] of Object.entries(rule.query ?? {})) if (!check(req.url.searchParams.get(k) === v)) return null;
  for (const [k, v] of Object.entries(rule.headers ?? {})) if (!check(req.headers.get(k) === v)) return null;
  if (rule.bodyContains !== undefined && !check(bodyText.toLowerCase().includes(rule.bodyContains.toLowerCase()))) return null;

  return score > 0 ? score : null;
}

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

function problem(status: number, message: string, source: Source, service?: Service): Resolution {
  return {
    service,
    source,
    note: message,
    status,
    headers: { "content-type": "application/json" },
    body: enc.encode(JSON.stringify({ mimic: { error: message } }, null, 2)),
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
  ) {}

  /** Resolve, delay, and record a request. */
  async handle(req: MockRequest, opts: { replayOf?: string } = {}): Promise<Resolution & { entry: HistoryEntry }> {
    const started = performance.now();
    const res = await this.resolve(req);
    if (res.delayMs > 0) await new Promise((r) => setTimeout(r, res.delayMs));
    const entry = this.record(req, res, performance.now() - started, opts.replayOf);
    return { ...res, entry };
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

  /** Picks the response; when Mimic would answer with its own error, the global error scenario (if set) is used instead. */
  async resolve(req: MockRequest): Promise<Resolution> {
    const res = await this.resolveOwn(req);
    if (res.source !== "error" && res.source !== "unmatched") return res;
    const global = this.store.globalErrorScenario();
    if (!global) return res;
    const { service: owner, scenario } = global;
    return {
      service: res.service,
      scenario,
      source: "fallback",
      note: `${res.note}; used global error scenario ${owner.id}/${scenario.id}`,
      status: scenario.status,
      headers: scenario.headers,
      body: enc.encode(scenario.body),
      delayMs: scenario.delayMs ?? res.service?.delayMs ?? owner.delayMs,
    };
  }

  private async resolveOwn(req: MockRequest): Promise<Resolution> {
    const match = this.store.resolve(req.method, req.url.pathname);
    if (!match) {
      const hidden = this.store.resolve(req.method, req.url.pathname, { includeInactive: true });
      const why = hidden ? ` (service '${hidden.service.id}' matches but is outside the tag filter: ${this.store.activeTags.join(", ")})` : "";
      return problem(404, `No service matches ${req.method} ${req.url.pathname}${why}`, "unmatched");
    }
    const { service, params } = match;

    switch (service.mode) {
      case "static": {
        const sc = findScenario(service, service.defaultScenario);
        return sc
          ? fromScenario(service, sc, "scenario")
          : problem(500, `Service '${service.id}' is static but has no default scenario`, "error", service);
      }
      case "dynamic": {
        const bodyText = dec.decode(req.body);
        let best: { sc: Scenario; score: number } | null = null;
        for (const sc of service.scenarios) {
          const score = scoreMatch(sc.match, req, params, bodyText);
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

  private record(req: MockRequest, res: Resolution, durationMs: number, replayOf?: string): HistoryEntry {
    const headersOf = (h: Headers) => Object.fromEntries(h.entries());
    return this.history.add({
      ...(replayOf && { replayOf }),
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
