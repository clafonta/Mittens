import type { HistoryEntry } from "./history.js";
import { compilePath, matchPath } from "./path.js";
import type { MatchRule, Scenario, Service } from "./schema.js";

/** Response headers not worth replaying: transport details and headers Mittens sets itself. */
const DROP_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "keep-alive", "date", "age", "via", "alt-svc"]);
const dropHeader = (name: string) => DROP_HEADERS.has(name) || name.startsWith("access-control-") || name.startsWith("x-mittens-");

const TEXTUAL = /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|graphql|yaml)|image\/svg\+xml)/i;

export interface ScenarioDraft {
  scenario: Scenario;
  /** Things the user should know before saving (e.g. truncated or binary body). */
  warnings: string[];
  /** True when the draft cannot be saved faithfully (body was truncated). */
  blocked: boolean;
}

export function slugify(text: string, fallback = "recorded"): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || fallback;
}

/** `base`, or `base-2`, `base-3`, … if taken. */
export function uniqueScenarioId(service: Service, base: string): string {
  const taken = new Set(service.scenarios.map((s) => s.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Builds a scenario from a recorded request/response, ready to review and save. */
export function scenarioFromHistory(entry: HistoryEntry, service: Service): ScenarioDraft {
  const { request, response } = entry;
  const warnings: string[] = [];

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(response.headers)) if (!dropHeader(k.toLowerCase())) headers[k.toLowerCase()] = v;

  // Suggest a match rule from what identifies this request, so it's useful in dynamic mode.
  const match: MatchRule = {};
  const params = matchPath(compilePath(service.path), request.path);
  if (params && Object.keys(params).length) match.params = params;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (Object.keys(query).length) match.query = query;
  if (service.method === "ANY") match.method = request.method.toUpperCase() as MatchRule["method"];

  const pathTail = request.path.split("/").filter(Boolean).slice(-2).join("-");
  const id = uniqueScenarioId(service, slugify(`${request.method}-${pathTail}-${response.status}`));

  if (response.truncated) warnings.push("The recorded body was truncated (over 256 KB), so it can't be saved as a scenario.");
  const type = headers["content-type"];
  if (type && !TEXTUAL.test(type)) warnings.push(`The body is ${type}; scenarios store text, so binary content may not replay exactly.`);
  if (entry.serviceId !== service.id) warnings.push(`This request was handled by '${entry.serviceId ?? "no service"}'.`);

  return {
    scenario: {
      id,
      name: `Recorded ${request.method} ${request.path} → ${response.status}`.slice(0, 120),
      status: response.status,
      headers,
      body: response.body,
      match: Object.keys(match).length ? match : undefined,
      tags: ["recorded"],
    },
    warnings,
    blocked: response.truncated,
  };
}
