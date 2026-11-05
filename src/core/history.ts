import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ValidationResult } from "./validate.js";

export type Source = "scenario" | "proxy" | "fallback" | "unmatched" | "error";

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

/** Bounded, newest-first log of handled requests. Emits "entry" on each add. */
export class History extends EventEmitter<{ entry: [HistoryEntry]; clear: [] }> {
  private entries: HistoryEntry[] = [];

  constructor(private readonly limit = 500) {
    super();
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
