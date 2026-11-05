import { z } from "zod";
import type { Profile, ProfileEntry, Scenario, Service } from "../core/schema.js";

/** Raw form values keyed by field name, as submitted or as prefilled. */
export type FormValues = Record<string, string>;
/** Error messages keyed by field name; "_form" holds errors not tied to a field. */
export type FormErrors = Record<string, string>;

export class FormError extends Error {
  constructor(readonly errors: FormErrors) {
    super(Object.values(errors).join("; "));
  }
}

export function toValues(body: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
  return out;
}

const opt = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

function int(values: FormValues, field: string, errors: FormErrors): number | undefined {
  const raw = opt(values[field]);
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw)) {
    errors[field] = "Must be a whole number";
    return undefined;
  }
  return Number(raw);
}

const tags = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** Parses `name: value` lines. Blank lines are ignored. */
function pairs(values: FormValues, field: string, errors: FormErrors): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const lines = (values[field] ?? "").split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) {
      errors[field] = `Line ${i + 1}: expected "name: value"`;
      return undefined;
    }
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

const unpairs = (rec: Record<string, string> | undefined) =>
  Object.entries(rec ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

function done<T>(value: T, errors: FormErrors): T {
  if (Object.keys(errors).length) throw new FormError(errors);
  return value;
}

/** Maps Zod issues onto the most specific matching form field. */
export function zodToFormErrors(err: z.ZodError, fields: string[]): FormErrors {
  const errors: FormErrors = {};
  const byLength = [...fields].sort((a, b) => b.length - a.length);
  for (const issue of err.issues) {
    const path = issue.path.map(String).join(".");
    const field = byLength.find((f) => path === f || path.startsWith(f + ".")) ?? "_form";
    errors[field] ??= field === "_form" && path ? `${path}: ${issue.message}` : issue.message;
  }
  return errors;
}

// ------------------------------------------------------------------ services

export const SERVICE_FIELDS = ["id", "name", "description", "path", "method", "mode", "upstream", "delayMs", "tags", "defaultScenario", "errorScenario"];

export function serviceFromForm(values: FormValues) {
  const errors: FormErrors = {};
  const input = {
    id: opt(values.id),
    name: opt(values.name),
    description: values.description?.trim() ?? "",
    path: opt(values.path),
    method: opt(values.method) ?? "ANY",
    mode: opt(values.mode) ?? "static",
    upstream: opt(values.upstream),
    delayMs: int(values, "delayMs", errors) ?? 0,
    tags: tags(values.tags),
    defaultScenario: opt(values.defaultScenario),
    errorScenario: opt(values.errorScenario),
  };
  return done(input, errors);
}

export function serviceToValues(s: Service): FormValues {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    path: s.path,
    method: s.method,
    mode: s.mode,
    upstream: s.upstream ?? "",
    delayMs: String(s.delayMs),
    tags: s.tags.join(", "),
    defaultScenario: s.defaultScenario ?? "",
    errorScenario: s.errorScenario ?? "",
  };
}

// ----------------------------------------------------------------- scenarios

export const SCENARIO_FIELDS = [
  "id",
  "name",
  "status",
  "headers",
  "body",
  "delayMs",
  "tags",
  "match",
  "match.method",
  "match.params",
  "match.query",
  "match.headers",
  "match.bodyContains",
];

export function scenarioFromForm(values: FormValues) {
  const errors: FormErrors = {};
  const match = {
    method: opt(values["match.method"]),
    params: pairs(values, "match.params", errors),
    query: pairs(values, "match.query", errors),
    headers: pairs(values, "match.headers", errors),
    bodyContains: opt(values["match.bodyContains"]),
  };
  const hasMatch = Object.values(match).some((v) => v !== undefined);
  const input = {
    id: opt(values.id),
    name: opt(values.name),
    status: int(values, "status", errors) ?? 200,
    headers: pairs(values, "headers", errors) ?? {},
    // Normalise line endings from browser textareas; keep the body otherwise verbatim.
    body: (values.body ?? "").replace(/\r\n/g, "\n"),
    delayMs: int(values, "delayMs", errors),
    tags: tags(values.tags),
    match: hasMatch ? match : undefined,
  };
  return done(input, errors);
}

export function scenarioToValues(s: Scenario): FormValues {
  return {
    id: s.id,
    name: s.name,
    status: String(s.status),
    headers: unpairs(s.headers),
    body: s.body,
    delayMs: s.delayMs === undefined ? "" : String(s.delayMs),
    tags: s.tags.join(", "),
    "match.method": s.match?.method ?? "",
    "match.params": unpairs(s.match?.params),
    "match.query": unpairs(s.match?.query),
    "match.headers": unpairs(s.match?.headers),
    "match.bodyContains": s.match?.bodyContains ?? "",
  };
}

// ------------------------------------------------------------------ profiles
//
// Per-service fields are named `svc.<serviceId>.include|mode|scenario`.

export const PROFILE_FIELDS = ["id", "name", "description", "services"];

export function profileFromForm(values: FormValues) {
  const services: Record<string, ProfileEntry> = {};
  for (const [key, v] of Object.entries(values)) {
    const m = /^svc\.([^.]+)\.include$/.exec(key);
    if (!m || !v) continue;
    const id = m[1]!;
    const mode = opt(values[`svc.${id}.mode`]);
    const scenario = opt(values[`svc.${id}.scenario`]);
    services[id] = { ...(mode && { mode: mode as ProfileEntry["mode"] }), ...(scenario && { scenario }) };
  }
  return done(
    { id: opt(values.id), name: opt(values.name), description: values.description?.trim() ?? "", services },
    {},
  );
}

export function profileToValues(p: Profile): FormValues {
  const values: FormValues = { id: p.id, name: p.name, description: p.description };
  for (const [id, entry] of Object.entries(p.services)) {
    values[`svc.${id}.include`] = "on";
    values[`svc.${id}.mode`] = entry.mode ?? "";
    values[`svc.${id}.scenario`] = entry.scenario ?? "";
  }
  return values;
}
