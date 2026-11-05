import type { History, HistoryEntry } from "./history.js";

/** Sparkline window: 20 buckets of 30 s = the last 10 minutes. */
export const RATE_BUCKET_MS = 30_000;
export const RATE_BUCKETS = 20;

export interface RateSeries {
  /** Index of the newest bucket (epoch ms / RATE_BUCKET_MS), so clients can keep sliding the window. */
  end: number;
  /** Requests per bucket, oldest first. */
  counts: number[];
  /** Of those, responses with status >= 400. */
  errors: number[];
}

/** Key for requests no service answered. */
export const UNMATCHED = "";

/**
 * Requests per service in recent 30-second buckets, for sparklines. Kept
 * apart from History so the numbers don't depend on its size limit or on
 * it being cleared. Old buckets are dropped as new ones arrive.
 */
export class Rates {
  private buckets = new Map<string, Map<number, { n: number; e: number }>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Counts every new history entry, and seeds from what's already there (e.g. restored history). */
  attach(history: History) {
    for (const e of history.list().reverse()) this.add(e);
    history.on("entry", (e) => this.add(e));
    return this;
  }

  add(entry: Pick<HistoryEntry, "serviceId" | "at" | "response">) {
    this.record(entry.serviceId ?? UNMATCHED, Date.parse(entry.at), entry.response.status >= 400);
  }

  record(key: string, atMs: number, error: boolean) {
    const bucket = Math.floor(atMs / RATE_BUCKET_MS);
    const newest = Math.floor(this.now() / RATE_BUCKET_MS);
    if (bucket <= newest - RATE_BUCKETS || Number.isNaN(bucket)) return;
    let series = this.buckets.get(key);
    if (!series) this.buckets.set(key, (series = new Map()));
    const b = series.get(bucket) ?? { n: 0, e: 0 };
    b.n++;
    if (error) b.e++;
    series.set(bucket, b);
    for (const k of series.keys()) if (k <= newest - RATE_BUCKETS) series.delete(k);
  }

  series(key: string): RateSeries {
    const end = Math.floor(this.now() / RATE_BUCKET_MS);
    const series = this.buckets.get(key);
    const counts: number[] = [];
    const errors: number[] = [];
    for (let b = end - RATE_BUCKETS + 1; b <= end; b++) {
      const v = series?.get(b);
      counts.push(v?.n ?? 0);
      errors.push(v?.e ?? 0);
    }
    return { end, counts, errors };
  }
}
