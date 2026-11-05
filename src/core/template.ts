import { randomInt as cryptoRandomInt, randomUUID } from "node:crypto";
import type { MatchInput } from "./match.js";

/**
 * Response templates: `{{ expression | filter arg ... }}` inside a scenario
 * body or header value, when the scenario has `template: true`.
 *
 *   values   params.id  query.page  headers.x-tenant  body  body.user.name  body.items[0].sku
 *            method  path  url
 *   helpers  uuid  now  timestamp  randomInt <min> <max>
 *   filters  default "x"  upper  lower  json
 *
 * Unknown values render as "" (use `default`). `\{{` writes a literal `{{`.
 * Templates are parsed when the scenario is saved, so rendering never throws.
 */

export class TemplateError extends Error {}

type Literal = string | number;
type Expr =
  | { kind: "path"; root: string; segments: (string | number)[] }
  | { kind: "helper"; name: string; args: Literal[] }
  | { kind: "literal"; value: Literal };
interface Filter {
  name: string;
  args: Literal[];
}
type Node = { kind: "text"; text: string } | { kind: "expr"; expr: Expr; filters: Filter[] };

const ROOTS = new Set(["params", "query", "headers", "body", "method", "path", "url"]);
const HELPERS: Record<string, number> = { uuid: 0, now: 0, timestamp: 0, randomInt: 2 };
const FILTERS: Record<string, number> = { default: 1, upper: 0, lower: 0, json: 0 };

// ------------------------------------------------------------------ parsing

type Token = { type: "ident"; value: string } | { type: "literal"; value: Literal } | { type: "pipe" };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "|") {
      tokens.push({ type: "pipe" });
      i++;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        value += src[j];
        j++;
      }
      if (j >= src.length) throw new TemplateError(`Unterminated string in {{${src}}}`);
      tokens.push({ type: "literal", value });
      i = j + 1;
    } else if (/[-\d]/.test(ch) && /^-?\d/.test(src.slice(i))) {
      const m = /^-?\d+(\.\d+)?/.exec(src.slice(i))!;
      tokens.push({ type: "literal", value: Number(m[0]) });
      i += m[0].length;
    } else {
      // Paths: letters, digits, _ and - (header names), dots, and [n] indexes.
      const m = /^[A-Za-z_][\w-]*(?:\.[\w-]+|\[\d+\])*/.exec(src.slice(i));
      if (!m) throw new TemplateError(`Unexpected '${ch}' in {{${src}}}`);
      tokens.push({ type: "ident", value: m[0] });
      i += m[0].length;
    }
  }
  return tokens;
}

function parsePath(raw: string, src: string): Expr {
  const segments: (string | number)[] = [];
  const re = /\.([\w-]+)|\[(\d+)\]/g;
  const root = /^[A-Za-z_][\w-]*/.exec(raw)![0];
  let m: RegExpExecArray | null;
  re.lastIndex = root.length;
  while ((m = re.exec(raw))) segments.push(m[1] !== undefined ? m[1] : Number(m[2]));
  if (!ROOTS.has(root)) {
    throw new TemplateError(`Unknown value '${root}' in {{${src}}}. Use params, query, headers, body, method, path, url, or a helper (${Object.keys(HELPERS).join(", ")})`);
  }
  if (["method", "path", "url"].includes(root) && segments.length) throw new TemplateError(`'${root}' has no fields, in {{${src}}}`);
  return { kind: "path", root, segments };
}

const takeArgs = (tokens: Token[], i: number, count: number, what: string, src: string): [Literal[], number] => {
  const args: Literal[] = [];
  for (let k = 0; k < count; k++) {
    const t = tokens[i + k];
    if (!t || t.type !== "literal") throw new TemplateError(`'${what}' needs ${count} argument${count === 1 ? "" : "s"}, in {{${src}}}`);
    args.push(t.value);
  }
  return [args, i + count];
};

function parseTag(src: string): Node {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new TemplateError("Empty {{ }}");
  let i = 0;
  let expr: Expr;
  const first = tokens[i++]!;
  if (first.type === "literal") expr = { kind: "literal", value: first.value };
  else if (first.type === "ident" && first.value in HELPERS) {
    const [args, next] = takeArgs(tokens, i, HELPERS[first.value]!, first.value, src);
    i = next;
    expr = { kind: "helper", name: first.value, args };
  } else if (first.type === "ident") expr = parsePath(first.value, src);
  else throw new TemplateError(`Expected a value before '|' in {{${src}}}`);

  const filters: Filter[] = [];
  while (i < tokens.length) {
    const t = tokens[i++]!;
    if (t.type !== "pipe") throw new TemplateError(`Expected '|' before '${t.type === "ident" ? t.value : String(t.value)}' in {{${src}}}`);
    const name = tokens[i++];
    if (!name || name.type !== "ident" || !(name.value in FILTERS)) {
      throw new TemplateError(`Unknown filter in {{${src}}}; use ${Object.keys(FILTERS).join(", ")}`);
    }
    const [args, next] = takeArgs(tokens, i, FILTERS[name.value]!, name.value, src);
    i = next;
    filters.push({ name: name.value, args });
  }
  return { kind: "expr", expr, filters };
}

const cache = new Map<string, Node[]>();

export function parseTemplate(source: string): Node[] {
  const hit = cache.get(source);
  if (hit) return hit;
  const nodes: Node[] = [];
  let text = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("\\{{", i)) {
      text += "{{";
      i += 3;
    } else if (source.startsWith("{{", i)) {
      const end = source.indexOf("}}", i + 2);
      if (end < 0) throw new TemplateError(`Unclosed {{ at character ${i + 1}`);
      if (text) nodes.push({ kind: "text", text });
      text = "";
      nodes.push(parseTag(source.slice(i + 2, end).trim()));
      i = end + 2;
    } else {
      text += source[i++];
    }
  }
  if (text) nodes.push({ kind: "text", text });
  if (cache.size > 500) cache.clear();
  cache.set(source, nodes);
  return nodes;
}

/** Why a template can't be used, or undefined. */
export function templateProblem(source: string): string | undefined {
  try {
    parseTemplate(source);
    return undefined;
  } catch (err) {
    return err instanceof TemplateError ? err.message : String(err);
  }
}

// ---------------------------------------------------------------- rendering

function lookup(expr: Extract<Expr, { kind: "path" }>, input: MatchInput): unknown {
  switch (expr.root) {
    case "method":
      return input.method.toUpperCase();
    case "path":
      return input.url.pathname;
    case "url":
      return input.url.toString();
  }
  const [first, ...rest] = expr.segments;
  let value: unknown;
  if (expr.root === "params") value = first === undefined ? input.params : input.params[String(first)];
  else if (expr.root === "query") value = first === undefined ? Object.fromEntries(input.url.searchParams) : (input.url.searchParams.get(String(first)) ?? undefined);
  else if (expr.root === "headers") value = first === undefined ? Object.fromEntries(input.headers) : (input.headers.get(String(first)) ?? undefined);
  else {
    // body: raw text on its own, JSON when you reach into it
    if (first === undefined) return input.bodyText;
    const parsed = input.json();
    if (!parsed.ok) return undefined;
    value = parsed.value;
    for (const seg of expr.segments) value = value !== null && typeof value === "object" ? (value as Record<string, unknown>)[seg] : undefined;
    return value;
  }
  return rest.length ? undefined : value;
}

function evaluate(expr: Expr, input: MatchInput): unknown {
  if (expr.kind === "literal") return expr.value;
  if (expr.kind === "path") return lookup(expr, input);
  switch (expr.name) {
    case "uuid":
      return randomUUID();
    case "now":
      return new Date().toISOString();
    case "timestamp":
      return Date.now();
    default: {
      const [a, b] = expr.args.map(Number) as [number, number];
      const lo = Math.ceil(Math.min(a, b));
      const hi = Math.floor(Math.max(a, b));
      return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? cryptoRandomInt(lo, hi + 1) : "";
    }
  }
}

const asText = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function applyFilter(value: unknown, f: Filter): unknown {
  switch (f.name) {
    case "default":
      return value === undefined || value === null || value === "" ? f.args[0] : value;
    case "upper":
      return asText(value).toUpperCase();
    case "lower":
      return asText(value).toLowerCase();
    default:
      return JSON.stringify(value ?? null);
  }
}

/** Renders a (pre-validated) template; an invalid one is returned unchanged. */
export function renderTemplate(source: string, input: MatchInput): string {
  let nodes: Node[];
  try {
    nodes = parseTemplate(source);
  } catch {
    return source;
  }
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") out += node.text;
    else out += asText(node.filters.reduce((v, f) => applyFilter(v, f), evaluate(node.expr, input)));
  }
  return out;
}
