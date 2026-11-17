import { STATUS_CODES } from "node:http";
import type { HistoryEntry } from "./history.js";

/** HAR 1.2 (http://www.softwareishard.com/blog/har-12-spec/). Mittens-specific data goes in `_mittens`. */
export interface Har {
  log: {
    version: "1.2";
    creator: { name: string; version: string };
    entries: unknown[];
  };
}

const nameValues = (rec: Record<string, string>) => Object.entries(rec).map(([name, value]) => ({ name, value }));
const header = (rec: Record<string, string>, name: string) =>
  Object.entries(rec).find(([k]) => k.toLowerCase() === name)?.[1];
const byteLength = (s: string) => Buffer.byteLength(s);

function harEntry(e: HistoryEntry) {
  const url = new URL(e.request.url);
  const requestType = header(e.request.headers, "content-type");
  const responseType = header(e.response.headers, "content-type") ?? "";
  return {
    startedDateTime: e.at,
    time: e.durationMs,
    request: {
      method: e.request.method,
      url: e.request.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: nameValues(e.request.headers),
      queryString: [...url.searchParams].map(([name, value]) => ({ name, value })),
      ...(e.request.body && { postData: { mimeType: requestType ?? "", text: e.request.body } }),
      headersSize: -1,
      bodySize: e.request.body ? byteLength(e.request.body) : 0,
    },
    response: {
      status: e.response.status,
      statusText: STATUS_CODES[e.response.status] ?? "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: nameValues(e.response.headers),
      content: { size: byteLength(e.response.body), mimeType: responseType, text: e.response.body },
      redirectURL: header(e.response.headers, "location") ?? "",
      headersSize: -1,
      bodySize: byteLength(e.response.body),
    },
    cache: {},
    timings: { send: 0, wait: e.durationMs, receive: 0 },
    ...(e.note && { comment: e.note }),
    _mittens: {
      id: e.id,
      source: e.source,
      ...(e.serviceId && { service: e.serviceId }),
      ...(e.scenarioId && { scenario: e.scenarioId }),
      ...(e.replayOf && { replayOf: e.replayOf }),
      ...(e.validation && { validation: e.validation }),
      ...((e.request.truncated || e.response.truncated) && {
        truncated: { request: e.request.truncated, response: e.response.truncated },
      }),
    },
  };
}

/** Builds a HAR log, oldest request first (history itself is newest first). */
export function toHar(entries: HistoryEntry[], version: string): Har {
  return {
    log: {
      version: "1.2",
      creator: { name: "Mittens", version },
      entries: [...entries].reverse().map(harEntry),
    },
  };
}
