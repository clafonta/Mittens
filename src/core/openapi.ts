import YAML from "yaml";
import { slugify } from "./record.js";
import { HttpMethod, type Scenario, type Service, type ServiceMode } from "./schema.js";
import { matchesSchema } from "./validate.js";

/**
 * Turns an OpenAPI 3.0 / 3.1 document into Mimic services:
 *
 * - one service per operation (path + method), id from operationId
 * - one scenario per response, or per named example; bodies come from the
 *   examples, or are generated from the schema when there are none
 * - response schemas become `responseSchema`, so responses are validated
 * - `servers[0]` gives the upstream (for proxy mode) and a path prefix
 *
 * Planning is pure: nothing is written until the plan is applied.
 */

export interface ImportOptions {
  /** Starting mode for every service (default static). Proxy needs an absolute server URL. */
  mode?: ServiceMode;
  /** Extra tags added to every service. */
  tags?: string[];
  /** Path prefix for every route; defaults to the path of servers[0] (e.g. /v1). */
  prefix?: string;
  /** Service ids and routes that already exist; matching operations are skipped. */
  existing?: { id: string; method: string; path: string }[];
}

export interface ImportPlan {
  title: string;
  services: Service[];
  skipped: { id: string; route: string; reason: string }[];
  warnings: string[];
}

export class ImportError extends Error {}

/** Parses import options from form/query strings; invalid values throw ImportError. */
export function importOptionsFrom(raw: { mode?: string; prefix?: string; tags?: string }): Omit<ImportOptions, "existing"> {
  const mode = raw.mode?.trim() || undefined;
  if (mode && !["static", "dynamic", "proxy"].includes(mode)) throw new ImportError(`Unknown mode '${mode}'`);
  const prefix = raw.prefix?.trim() || undefined;
  if (prefix && !prefix.startsWith("/")) throw new ImportError("The path prefix must start with /");
  const tags = (raw.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return { ...(mode && { mode: mode as ServiceMode }), ...(prefix && { prefix }), ...(tags.length && { tags }) };
}

/** A compact view of a plan or result, for the API and dashboard. */
export function summarize(plan: ImportPlan | ImportResult) {
  const done = "created" in plan ? new Set(plan.created) : undefined;
  return {
    title: plan.title,
    services: plan.services
      .filter((s) => !done || done.has(s.id))
      .map((s) => ({ id: s.id, method: s.method, path: s.path, name: s.name, scenarios: s.scenarios.length, schema: !!s.responseSchema })),
    skipped: plan.skipped,
    warnings: plan.warnings,
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const MAX_DEPTH = 8;

/** Parses JSON or YAML text. */
export function parseSpec(text: string): unknown {
  try {
    return YAML.parse(text, { maxAliasCount: 1000 });
  } catch (err) {
    throw new ImportError(`Couldn't parse the spec as JSON or YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ------------------------------------------------------------- $ref handling

class Resolver {
  readonly warnings = new Set<string>();
  constructor(private readonly doc: Obj) {}

  /** Follows a local "#/a/b" reference. */
  target(ref: string): unknown {
    if (!ref.startsWith("#/")) {
      this.warnings.add(`External reference '${ref}' isn't supported; treated as an empty schema`);
      return undefined;
    }
    let node: unknown = this.doc;
    for (const raw of ref.slice(2).split("/")) {
      const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      node = isObj(node) || Array.isArray(node) ? (node as Obj)[key] : undefined;
    }
    if (node === undefined) this.warnings.add(`Reference '${ref}' points nowhere; treated as an empty schema`);
    return node;
  }

  /** A non-schema object (response, example) with its $ref followed. */
  deref<T = Obj>(v: unknown, seen = new Set<string>()): T | undefined {
    if (isObj(v) && typeof v.$ref === "string") {
      if (seen.has(v.$ref)) return undefined;
      seen.add(v.$ref);
      return this.deref<T>(this.target(v.$ref), seen);
    }
    return v as T | undefined;
  }

  /**
   * A self-contained JSON Schema: $refs inlined (cycles cut to `{}`), and
   * OpenAPI 3.0 quirks converted (nullable, boolean exclusiveMinimum/Maximum).
   */
  schema(v: unknown, stack: string[] = []): unknown {
    if (Array.isArray(v)) return v.map((x) => this.schema(x, stack));
    if (!isObj(v)) return v;
    if (typeof v.$ref === "string") {
      if (stack.includes(v.$ref)) {
        this.warnings.add(`Recursive schema '${v.$ref}' is only checked to its first level`);
        return {};
      }
      const { $ref, ...siblings } = v; // 3.1 allows siblings next to $ref
      const resolved = this.schema(this.target($ref), [...stack, $ref]);
      return Object.keys(siblings).length && isObj(resolved) ? { ...resolved, ...(this.schema(siblings, stack) as Obj) } : (resolved ?? {});
    }
    const out: Obj = {};
    for (const [k, child] of Object.entries(v)) {
      // Keep literal data (examples, defaults, enums) as-is; walk everything else.
      out[k] = ["example", "examples", "default", "enum", "const"].includes(k) ? child : this.schema(child, stack);
    }
    if (out.nullable === true) {
      delete out.nullable;
      if (typeof out.type === "string") out.type = [out.type, "null"];
      else if (out.type === undefined) return { anyOf: [out, { type: "null" }] };
    } else delete out.nullable;
    for (const [flag, bound] of [
      ["exclusiveMinimum", "minimum"],
      ["exclusiveMaximum", "maximum"],
    ] as const) {
      if (out[flag] === true && typeof out[bound] === "number") {
        out[flag] = out[bound];
        delete out[bound];
      } else if (typeof out[flag] === "boolean") delete out[flag];
    }
    return out;
  }
}

// ----------------------------------------------------------- sample bodies

const STRING_FORMATS: Record<string, string> = {
  "date-time": "2030-01-01T00:00:00Z",
  date: "2030-01-01",
  time: "00:00:00Z",
  email: "user@example.com",
  uuid: "00000000-0000-4000-8000-000000000000",
  uri: "https://example.com",
  url: "https://example.com",
  hostname: "example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  byte: "",
};

/** A plausible value for a (dereferenced) schema; deterministic so files diff cleanly. */
export function sampleFor(schema: unknown, depth = 0, minimal = false): unknown {
  if (!isObj(schema) || depth > MAX_DEPTH) return isObj(schema) ? {} : null;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map((s) => sampleFor(s, depth + 1, minimal));
    return parts.every(isObj) ? Object.assign({}, ...parts) : parts.find((p) => p !== null) ?? null;
  }
  for (const k of ["oneOf", "anyOf"] as const) {
    const options = schema[k];
    if (Array.isArray(options) && options.length) {
      const candidates = [...options.filter((o) => !(isObj(o) && o.type === "null")), ...options.filter((o) => isObj(o) && o.type === "null")];
      const samples = candidates.map((o) => sampleFor(o, depth + 1, minimal));
      // For oneOf, a sample can accidentally fit several options; prefer one that fits exactly one,
      // falling back to required-properties-only samples, which overlap less.
      if (k === "oneOf" && depth <= 2) {
        const fits = (v: unknown) => matchesSchema(schema, v);
        return samples.find(fits) ?? candidates.map((o) => sampleFor(o, depth + 1, true)).find(fits) ?? samples[0];
      }
      return samples[0];
    }
  }
  const type = Array.isArray(schema.type) ? (schema.type.find((t) => t !== "null") ?? "null") : schema.type;
  if (type === "object" || (type === undefined && isObj(schema.properties))) {
    const out: Obj = {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [name, prop] of Object.entries(isObj(schema.properties) ? schema.properties : {})) {
      if ((isObj(prop) && prop.writeOnly === true) || (minimal && !required.has(name))) continue;
      out[name] = sampleFor(prop, depth + 1, minimal);
    }
    return out;
  }
  if (type === "array") {
    if (schema.items === undefined || schema.items === false) return [];
    const item = sampleFor(schema.items, depth + 1, minimal);
    const count = typeof schema.minItems === "number" ? Math.max(1, schema.minItems) : 1;
    return Array.from({ length: count }, () => structuredClone(item));
  }
  if (type === "string") {
    let text = STRING_FORMATS[String(schema.format)] ?? "string";
    if (typeof schema.minLength === "number" && text.length < schema.minLength) text = text.padEnd(schema.minLength, "x");
    if (typeof schema.maxLength === "number" && text.length > schema.maxLength) text = text.slice(0, schema.maxLength);
    return text;
  }
  if (type === "integer" || type === "number") return sampleNumber(schema, type === "integer");
  if (type === "boolean") return true;
  if (type === "null") return null;
  return {};
}

/** A number inside the schema's bounds: the lowest allowed value, else 0 if allowed, else the highest. */
function sampleNumber(schema: Obj, integer: boolean): number {
  const num = (k: string) => (typeof schema[k] === "number" ? (schema[k] as number) : undefined);
  const step = integer ? 1 : 0.5;
  const low = num("minimum") ?? (num("exclusiveMinimum") !== undefined ? num("exclusiveMinimum")! + step : undefined);
  const high = num("maximum") ?? (num("exclusiveMaximum") !== undefined ? num("exclusiveMaximum")! - step : undefined);
  let value = low ?? (high !== undefined && high < 0 ? high : 0);
  if (integer) value = Math.ceil(value);
  return value;
}

// ------------------------------------------------------------------ servers

/**
 * Hosts reserved for documentation and testing (RFC 2606/6761): a spec's
 * servers often use them as placeholders, so they make poor upstreams.
 */
export function isPlaceholderHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return /(^|\.)example\.(com|net|org)$/.test(h) || /\.(example|test|invalid)$/.test(h) || ["example", "test", "invalid"].includes(h);
}

function serverParts(doc: Obj): { upstream?: string; prefix: string; placeholder?: string } {
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const first = servers.find(isObj);
  if (!first || typeof first.url !== "string") return { prefix: "" };
  // Fill {variables} with their defaults.
  const vars = isObj(first.variables) ? first.variables : {};
  const url = first.url.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = vars[name];
    return isObj(v) && v.default !== undefined ? String(v.default) : "";
  });
  try {
    const parsed = new URL(url);
    const prefix = parsed.pathname.replace(/\/+$/, "");
    if (isPlaceholderHost(parsed.host)) return { prefix, placeholder: parsed.host };
    return { upstream: parsed.origin, prefix };
  } catch {
    return { prefix: url.startsWith("/") ? url.replace(/\/+$/, "") : "" }; // relative server URL
  }
}

// --------------------------------------------------------------- responses

function pickMedia(content: unknown): [string, Obj] | undefined {
  if (!isObj(content)) return undefined;
  const entries = Object.entries(content).filter((e): e is [string, Obj] => isObj(e[1]));
  return (
    entries.find(([t]) => /^application\/json\b/i.test(t)) ??
    entries.find(([t]) => /\+json\b/i.test(t)) ??
    entries.find(([t]) => t.includes("*")) ??
    entries[0]
  );
}

const isJsonType = (t: string) => /json/i.test(t) || t.includes("*");
const statusOf = (key: string) => (/^\d{3}$/.test(key) ? Number(key) : /^[1-5]XX$/i.test(key) ? Number(key[0]) * 100 : 500);
const schemaKey = (key: string) => (/^[1-5]XX$/i.test(key) ? key.toLowerCase() : key);
const bodyText = (v: unknown, json: boolean) => (typeof v === "string" && !json ? v : `${JSON.stringify(v, null, 2)}\n`);

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function scenariosFor(
  responses: Obj,
  r: Resolver,
): { scenarios: Scenario[]; schemas: Record<string, unknown> } {
  const scenarios: Scenario[] = [];
  const schemas: Record<string, unknown> = {};
  const ids = new Set<string>();
  const keys = Object.keys(responses).sort((a, b) => statusOf(a) - statusOf(b) || a.localeCompare(b));
  for (const key of keys) {
    const response = r.deref(responses[key]);
    if (!isObj(response)) continue;
    const status = statusOf(key);
    const description = typeof response.description === "string" ? response.description.trim().split("\n")[0]! : "";
    const label = `${key}${description ? ` ${description}` : ""}`.slice(0, 80);
    // "409" + "Not enough stock" → 409-not-enough-stock: readable in the dashboard, and never a bare number in YAML.
    const describe = description ? slugify(description.split(/\s+/).slice(0, 5).join(" "), "").slice(0, 32).replace(/-+$/, "") : "";
    const media = pickMedia(response.content);
    if (!media) {
      scenarios.push({ id: uniqueId(slugify(describe ? `${key}-${describe}` : key, "response"), ids), name: label, status, headers: {}, body: "", tags: [] });
      continue;
    }
    const [type, mt] = media;
    const json = isJsonType(type);
    const contentType = type.includes("*") ? "application/json" : type;
    const schema = mt.schema === undefined ? undefined : r.schema(mt.schema);
    if (json && schema !== undefined) schemas[schemaKey(key)] = schema;

    const named = isObj(mt.examples)
      ? Object.entries(mt.examples)
          .map(([name, ex]) => [name, r.deref(ex)] as const)
          .filter((e): e is readonly [string, Obj] => isObj(e[1]) && "value" in e[1])
      : [];
    const make = (suffix: string, name: string, value: unknown) =>
      scenarios.push({
        id: uniqueId(slugify(suffix ? `${key}-${suffix}` : key, "response"), ids),
        name,
        status,
        headers: { "content-type": contentType },
        body: bodyText(value, json),
        tags: [],
      });
    if (named.length) {
      for (const [name, ex] of named) make(name, `${label} (${typeof ex.summary === "string" ? ex.summary : name})`.slice(0, 120), ex.value);
    } else {
      make(describe, label, mt.example !== undefined ? mt.example : sampleFor(schema));
    }
  }
  return { scenarios, schemas };
}

// --------------------------------------------------------------------- plan

const toMimicPath = (prefix: string, path: string) =>
  `${prefix}${path}`
    // Only letters, digits, _ and - are allowed in Mimic param names.
    .replace(/\{([^}]+)\}/g, (_, name: string) => `{${name.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[^A-Za-z_]/, "_$&")}}`)
    .replace(/\/{2,}/g, "/") || "/";

export function planImport(input: unknown, opts: ImportOptions = {}): ImportPlan {
  if (!isObj(input)) throw new ImportError("The spec is empty or not an object");
  if (typeof input.swagger === "string") {
    throw new ImportError("Swagger 2.0 isn't supported. Convert it to OpenAPI 3 first, e.g. with https://converter.swagger.io");
  }
  if (typeof input.openapi !== "string" || !/^3\.[01]/.test(input.openapi)) {
    throw new ImportError(`Expected an OpenAPI 3.0 or 3.1 document (found openapi: ${JSON.stringify(input.openapi ?? null)})`);
  }
  if (!isObj(input.paths)) throw new ImportError("The spec has no paths");

  const r = new Resolver(input);
  const info = isObj(input.info) ? input.info : {};
  const title = typeof info.title === "string" ? info.title : "API";
  const server = serverParts(input);
  const prefix = (opts.prefix ?? server.prefix).replace(/\/+$/, "");
  const extraTags = opts.tags ?? [];
  const existing = opts.existing ?? [];
  const takenIds = new Set(existing.map((e) => e.id));
  const existingRoutes = new Map(existing.map((e) => [`${e.method} ${e.path}`, e.id]));

  let mode: ServiceMode = opts.mode ?? "static";
  const warnings: string[] = [];
  if (server.placeholder) {
    warnings.push(`servers[0] uses a placeholder host (${server.placeholder}), so no upstream was set; add one to a service to use proxy mode`);
  }
  if (mode === "proxy" && !server.upstream) {
    warnings.push("Proxy mode needs an absolute URL in servers[0]; services start in static mode instead");
    mode = "static";
  }

  const services: Service[] = [];
  const skipped: ImportPlan["skipped"] = [];
  const planned = new Set<string>();

  for (const [rawPath, rawItem] of Object.entries(input.paths)) {
    const item = r.deref(rawItem);
    if (!isObj(item)) continue;
    const path = toMimicPath(prefix, rawPath);
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const upper = method.toUpperCase();
      const route = `${upper} ${path}`;
      if (!HttpMethod.safeParse(upper).success) {
        skipped.push({ id: "", route, reason: `${upper} isn't supported by Mimic` });
        continue;
      }
      // listPets → list-pets
      const opId = typeof op.operationId === "string" ? op.operationId.replace(/([a-z0-9])([A-Z])/g, "$1-$2") : undefined;
      const base = slugify(opId ?? `${method}-${rawPath}`, "operation");
      const wanted = ["new", "apply"].includes(base) ? `${base}-op` : base;
      if (takenIds.has(wanted) && !planned.has(wanted)) {
        skipped.push({ id: wanted, route, reason: "a service with this id already exists" });
        continue;
      }
      const clash = existingRoutes.get(route);
      if (clash) {
        skipped.push({ id: wanted, route, reason: `service '${clash}' already handles this route` });
        continue;
      }
      const id = uniqueId(wanted, takenIds);
      planned.add(id);

      const responses = isObj(op.responses) ? op.responses : {};
      const { scenarios, schemas } = scenariosFor(responses, r);
      if (scenarios.length === 0) warnings.push(`${route} has no responses; its service has no scenarios`);
      const success = scenarios.find((s) => s.status >= 200 && s.status < 300) ?? scenarios[0];
      const tags = [...new Set([...(Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === "string") : []), ...extraTags])];
      services.push({
        id,
        name: (typeof op.summary === "string" && op.summary.trim()) || route,
        description: typeof op.description === "string" ? op.description.trim() : "",
        path,
        method: upper as Service["method"],
        mode,
        ...(success && { defaultScenario: success.id }),
        ...(server.upstream && { upstream: server.upstream }),
        delayMs: 0,
        tags,
        ...(Object.keys(schemas).length && { responseSchema: schemas }),
        scenarios,
      });
    }
  }

  return { title, services, skipped, warnings: [...warnings, ...r.warnings] };
}

export interface ImportResult extends ImportPlan {
  created: string[];
}

/** Creates the planned services. A service that fails validation is reported as skipped; the rest still import. */
export async function applyImport(store: { createService(input: unknown): Promise<Service> }, plan: ImportPlan): Promise<ImportResult> {
  const created: string[] = [];
  const skipped = [...plan.skipped];
  for (const service of plan.services) {
    try {
      await store.createService(service);
      created.push(service.id);
    } catch (err) {
      const detail = err instanceof Error ? err.message.split("\n").slice(0, 3).join(" ") : String(err);
      skipped.push({ id: service.id, route: `${service.method} ${service.path}`, reason: detail });
    }
  }
  return { ...plan, skipped, created };
}

/** Plain-text summary for the terminal. */
export function describePlan(plan: ImportPlan | ImportResult, dryRun: boolean): string {
  const lines: string[] = [];
  const done = "created" in plan ? new Set(plan.created) : undefined;
  const services = done ? plan.services.filter((s) => done.has(s.id)) : plan.services;
  lines.push(`${dryRun ? "Would import" : "Imported"} ${services.length} service${services.length === 1 ? "" : "s"} from "${plan.title}":`);
  const width = Math.min(48, Math.max(0, ...services.map((s) => `${s.method} ${s.path}`.length)));
  for (const s of services) {
    lines.push(`  ${`${s.method} ${s.path}`.padEnd(width)}  ${s.id}  (${s.scenarios.length} scenario${s.scenarios.length === 1 ? "" : "s"}${s.responseSchema ? ", schema" : ""})`);
  }
  if (plan.skipped.length) {
    lines.push(`Skipped ${plan.skipped.length}:`);
    for (const s of plan.skipped) lines.push(`  ${s.route}${s.id ? ` (${s.id})` : ""}: ${s.reason}`);
  }
  for (const w of plan.warnings) lines.push(`Note: ${w}`);
  return lines.join("\n");
}
