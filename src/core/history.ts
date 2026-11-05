import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ValidationResult } from "./validate.js";

export type Source = "scenario" | "proxy" | "hook" | "fallback" | "unmatched" | "error";

export interface HistoryEntry {
  id: string;
  at: string;
  durationMs: number;
  serviceId?: string;
  serviceName?: string;
  scenarioId?: string;
  source: Source;
  note?: string;
  /** Set when this request was a replay of an earlier history entry. */
  replayOf?: string;
  /** Result of checking the response against the service's responseSchema, when one applied. */
  validation?: ValidationResult;
  request: { method: string; url: string; path: string; headers: Record<string, string>; body: string; truncated: boolean };
  response: { status: number; headers: Record<string, string>; body: string; truncated: boolean };
}

/** What the live event stream sends for each request: enough to draw it, not the bodies. */
export interface RequestSummary {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  source: Source;
  serviceId?: string;
  scenarioId?: string;
  durationMs: number;
  /** Schema check result, when a schema applied. */
  valid?: boolean;
}

export const summarizeEntry = (e: HistoryEntry): RequestSummary => ({
  id: e.id,
  at: e.at,
  method: e.request.method,
  path: e.request.path,
  status: e.response.status,
  source: e.source,
  ...(e.serviceId && { serviceId: e.serviceId }),
  ...(e.scenarioId && { scenarioId: e.scenarioId }),
  durationMs: e.durationMs,
  ...(e.validation && { valid: e.validation.ok }),
});

/** Bounded, newest-first log of handled requests. Emits "entry" on each add. */
export class History extends EventEmitter<{ entry: [HistoryEntry]; clear: [] }> {
  private entries: HistoryEntry[] = [];

  /** Where history is saved, when persistence is on. */
  persistedTo: string | undefined;

  constructor(readonly limit = 500) {
    super();
  }

  /** Replaces the contents with previously saved entries (newest first), without emitting events. */
  restore(entries: HistoryEntry[]) {
    this.entries = entries.slice(0, this.limit);
  }

  add(entry: Omit<HistoryEntry, "id">): HistoryEntry {
    const full = { ...entry, id: randomUUID() };
    this.entries.unshift(full);
    if (this.entries.length > this.limit) this.entries.length = this.limit;
    this.emit("entry", full);
    return full;
  }

  list(filter: { serviceId?: string; validation?: "pass" | "fail" } = {}): HistoryEntry[] {
    return this.entries.filter(
      (e) =>
        (!filter.serviceId || e.serviceId === filter.serviceId) &&
        (!filter.validation || (e.validation !== undefined && e.validation.ok === (filter.validation === "pass"))),
    );
  }

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  clear() {
    this.entries = [];
    this.emit("clear");
  }
}
