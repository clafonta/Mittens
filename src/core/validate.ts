import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsModule from "ajv-formats";

/** JSON Schemas keyed by status: an exact code ("404"), a class ("2xx") or "default". */
export type ResponseSchemas = Record<string, unknown>;

export interface ValidationResult {
  /** Which key of responseSchema applied, e.g. "2xx". */
  schema: string;
  ok: boolean;
  /** Human-readable problems, at most MAX_ERRORS. */
  errors: string[];
}

const MAX_ERRORS = 10;
export const STATUS_KEY = /^([1-5]\d\d|[1-5]xx|default)$/;

// ajv-formats is CommonJS; its default export may arrive wrapped.
const addFormats = ((formatsModule as unknown as { default?: unknown }).default ?? formatsModule) as (ajv: Ajv) => Ajv;

// Real-world schemas (OpenAPI exports especially) carry extra keywords like `example`; don't reject them.
// `logger: false`: unknown formats are ignored quietly rather than warned about on every compile.
const options = { strict: false, allErrors: true, validateFormats: true, logger: false } as const;
/** OpenAPI formats that describe storage, not shape; accepted as-is. */
const OPENAPI_FORMATS = ["int32", "int64", "float", "double", "byte", "binary", "password"];
const setup = (ajv: Ajv) => {
  addFormats(ajv);
  for (const f of OPENAPI_FORMATS) ajv.addFormat(f, true);
  return ajv;
};
const ajv2020 = setup(new Ajv2020(options) as unknown as Ajv);
const ajv07 = setup(new Ajv(options));

/** Draft-07 and older schemas say so in $schema; everything else is treated as 2020-12. */
const engineFor = (schema: unknown) => {
  const declared = typeof schema === "object" && schema !== null ? (schema as { $schema?: unknown }).$schema : undefined;
  return typeof declared === "string" && /draft-0[4-7]/.test(declared) ? ajv07 : ajv2020;
};

const compiled = new WeakMap<object, ValidateFunction>();

function compile(schema: unknown): ValidateFunction {
  if (typeof schema === "boolean") return engineFor(schema).compile(schema);
  const key = schema as object;
  let fn = compiled.get(key);
  if (!fn) {
    // Don't let a top-level $id collide across services or reloads.
    const { $id: _id, ...rest } = schema as Record<string, unknown>;
    fn = engineFor(schema).compile(rest as AnySchema);
    compiled.set(key, fn);
  }
  return fn;
}

/** Whether a value satisfies a schema (false if the schema doesn't compile). */
export function matchesSchema(schema: unknown, value: unknown): boolean {
  try {
    return compile(schema)(value) === true;
  } catch {
    return false;
  }
}

/** Why a schema can't be used, or undefined if it compiles. */
export function schemaProblem(schema: unknown): string | undefined {
  if (typeof schema !== "boolean" && (typeof schema !== "object" || schema === null || Array.isArray(schema))) {
    return "Must be a JSON Schema object";
  }
  try {
    compile(schema);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** The schema key that applies to a status: exact code, then class, then default. */
export function schemaKeyFor(schemas: ResponseSchemas, status: number): string | undefined {
  return [String(status), `${String(status)[0]}xx`, "default"].find((k) => k in schemas);
}

const describe = (e: ErrorObject) => {
  const where = e.instancePath || "(root)";
  if (e.keyword === "additionalProperties") return `${where}: unexpected property '${(e.params as { additionalProperty: string }).additionalProperty}'`;
  if (e.keyword === "enum") return `${where}: must be one of ${JSON.stringify((e.params as { allowedValues: unknown[] }).allowedValues)}`;
  return `${where}: ${e.message}`;
};

/**
 * Checks a response body against the service's schema for that status.
 * Returns undefined when no schema applies.
 */
export function validateResponse(schemas: ResponseSchemas | undefined, status: number, body: string): ValidationResult | undefined {
  if (!schemas) return undefined;
  const key = schemaKeyFor(schemas, status);
  if (!key) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { schema: key, ok: false, errors: [body.trim() ? "Body is not valid JSON" : "Body is empty"] };
  }
  const fn = compile(schemas[key]);
  if (fn(data)) return { schema: key, ok: true, errors: [] };
  const errors = (fn.errors ?? []).map(describe);
  const shown = errors.slice(0, MAX_ERRORS);
  if (errors.length > MAX_ERRORS) shown.push(`…and ${errors.length - MAX_ERRORS} more`);
  return { schema: key, ok: false, errors: shown };
}
