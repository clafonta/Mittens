import { z } from "zod";
import type { JsonTest, Profile, ProfileEntry, Scenario, Service, ValueTest } from "../core/schema.js";

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

/**
 * Parses match lines: `name: value` (exact) or `name ~ regex` / `name ~i regex`
 * (regular expression, optional flags). Whichever separator comes first wins.
 */
function matchPairs(values: FormValues, field: string, errors: FormErrors): Record<string, ValueTest> | undefined {
  const out: Record<string, ValueTest> = {};
  for (const [i, line] of (values[field] ?? "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    const tilde = line.indexOf("~");
    if (tilde > 0 && (colon < 0 || tilde < colon)) {
      const m = /^([^~]+?)\s*~([a-z]*)\s+(.+)$/.exec(line.trim());
      const flags = m?.[2] ?? "";
      if (!m || !/^[imsu]*$/.test(flags)) {
        errors[field] = `Line ${i + 1}: expected "name ~ regex" (flags: ~i, ~m, ~s, ~u)`;
        return undefined;
      }
      const regex = m[3]!.trim();
      if (!validRegex(regex)) {
        errors[field] = `Line ${i + 1}: "${regex}" is not a valid regular expression`;
        return undefined;
      }
      out[m[1]!.trim()] = flags ? { regex, flags } : { regex };
    } else if (colon > 0) {
      out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    } else {
      errors[field] = `Line ${i + 1}: expected "name: value" or "name ~ regex"`;
      return undefined;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const validRegex = (s: string) => {
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
};

const unmatchPairs = (rec: Record<string, ValueTest> | undefined) =>
  Object.entries(rec ?? {})
    .map(([k, v]) => (typeof v === "string" ? `${k}: ${v}` : `${k} ~${v.flags ?? ""} ${v.regex}`))
    .join("\n");

/** A bare word stays a string; JSON scalars (7, true, null, "7") keep their type. */
function jsonScalar(raw: string): string | number | boolean | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) return v as string | number | boolean | null;
  } catch {
    // not JSON: a bare string
  }
  return raw;
}

/** Writes a scalar so jsonScalar reads it back unchanged. */
function showScalar(v: string | number | boolean | null): string {
  if (typeof v !== "string") return JSON.stringify(v);
  return jsonScalar(v) === v && v.trim() === v && v !== "" ? v : JSON.stringify(v);
}

/** Parses JSONPath lines: `$.a = value`, `$.a ~ regex`, `$.a exists`, `$.a missing`. */
function jsonTests(values: FormValues, field: string, errors: FormErrors): Record<string, JsonTest> | undefined {
  const out: Record<string, JsonTest> = {};
  for (const [i, raw] of (values[field] ?? "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const fail = (msg: string) => {
      errors[field] = `Line ${i + 1}: ${msg}`;
      return undefined;
    };
    if (!line.startsWith("$")) return fail("JSONPath expressions start with $");
    let m: RegExpExecArray | null;
    if ((m = /^(.+?)\s+(exists|missing)$/.exec(line))) out[m[1]!] = { exists: m[2] === "exists" };
    else if ((m = /^(.+?)\s+~([a-z]*)\s+(.+)$/.exec(line))) {
      const [, path, flags = "", regex] = m;
      if (!/^[imsu]*$/.test(flags)) return fail("regex flags may only be i, m, s, u");
      if (!validRegex(regex!)) return fail(`"${regex}" is not a valid regular expression`);
      out[path!] = flags ? { regex: regex!, flags } : { regex: regex! };
    } else if ((m = /^(.+?)\s+=\s+(.*)$/.exec(line))) out[m[1]!] = jsonScalar(m[2]!);
    else return fail('expected "$.path = value", "$.path ~ regex", "$.path exists" or "$.path missing"');
  }
  return Object.keys(out).length ? out : undefined;
}

const unjsonTests = (rec: Record<string, JsonTest> | undefined) =>
  Object.entries(rec ?? {})
    .map(([path, t]) => {
      if (t !== null && typeof t === "object" && "exists" in t) return `${path} ${t.exists ? "exists" : "missing"}`;
      if (t !== null && typeof t === "object") return `${path} ~${t.flags ?? ""} ${t.regex}`;
      return `${path} = ${showScalar(t)}`;
    })
    .join("\n");

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

export const SERVICE_FIELDS = [
  "id",
  "name",
  "description",
  "path",
  "method",
  "mode",
  "upstream",
  "stripPrefix",
  "rewrite",
  "responseSchema",
  "delayMs",
  "tags",
  "defaultScenario",
  "errorScenario",
];

const ARROW = " -> ";

/** Parses a JSON object field; blank means "not set". */
function jsonObject(values: FormValues, field: string, errors: FormErrors): Record<string, unknown> | undefined {
  const raw = opt(values[field]);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch (err) {
    errors[field] = err instanceof SyntaxError ? `Not valid JSON: ${err.message}` : 'Must be a JSON object like { "2xx": { …schema… } }';
    return undefined;
  }
}

/** Parses `from -> to` lines into rewrite rules. Blank lines are ignored. */
function rewriteRules(values: FormValues, errors: FormErrors) {
  const rules: { from: string; to: string }[] = [];
  for (const [i, line] of (values.rewrite ?? "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const idx = line.indexOf(ARROW);
    const from = idx < 0 ? "" : line.slice(0, idx).trim();
    if (!from) {
      errors.rewrite = `Line ${i + 1}: expected "pattern -> replacement"`;
      return undefined;
    }
    try {
      new RegExp(from);
    } catch {
      errors.rewrite = `Line ${i + 1}: "${from}" is not a valid regular expression`;
      return undefined;
    }
    rules.push({ from, to: line.slice(idx + ARROW.length).trim() });
  }
  return rules.length ? rules : undefined;
}

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
    stripPrefix: opt(values.stripPrefix),
    rewrite: rewriteRules(values, errors),
    responseSchema: jsonObject(values, "responseSchema", errors),
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
    stripPrefix: s.stripPrefix ?? "",
    rewrite: (s.rewrite ?? []).map((r) => `${r.from}${ARROW}${r.to}`).join("\n"),
    responseSchema: s.responseSchema ? JSON.stringify(s.responseSchema, null, 2) : "",
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
  "match.bodyMatches",
  "match.json",
];

function bodyRegex(values: FormValues, errors: FormErrors) {
  const regex = opt(values["match.bodyMatches"]);
  const flags = opt(values["match.bodyMatchesFlags"]);
  if (regex === undefined) return undefined;
  if (!validRegex(regex)) {
    errors["match.bodyMatches"] = "Not a valid regular expression";
    return undefined;
  }
  if (flags && !/^[imsu]*$/.test(flags)) {
    errors["match.bodyMatches"] = "Flags may only be i, m, s, u";
    return undefined;
  }
  return flags ? { regex, flags } : { regex };
}

export function scenarioFromForm(values: FormValues) {
  const errors: FormErrors = {};
  const match = {
    method: opt(values["match.method"]),
    params: matchPairs(values, "match.params", errors),
    query: matchPairs(values, "match.query", errors),
    headers: matchPairs(values, "match.headers", errors),
    bodyContains: opt(values["match.bodyContains"]),
    bodyMatches: bodyRegex(values, errors),
    json: jsonTests(values, "match.json", errors),
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
    "match.params": unmatchPairs(s.match?.params),
    "match.query": unmatchPairs(s.match?.query),
    "match.headers": unmatchPairs(s.match?.headers),
    "match.bodyContains": s.match?.bodyContains ?? "",
    "match.bodyMatches": s.match?.bodyMatches?.regex ?? "",
    "match.bodyMatchesFlags": s.match?.bodyMatches?.flags ?? "",
    "match.json": unjsonTests(s.match?.json),
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
