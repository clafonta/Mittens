import { JSONPath } from "jsonpath-plus";
import type { JsonTest, MatchRule, RegexTest, ValueTest } from "./schema.js";

/** What a match rule is tested against. Body parsing is lazy and done once per request. */
export class MatchInput {
  private parsed: { ok: true; value: unknown } | { ok: false } | undefined;

  constructor(
    readonly method: string,
    readonly url: URL,
    readonly headers: Headers,
    readonly params: Record<string, string>,
    readonly bodyText: string,
  ) {}

  /** The body as JSON, or undefined if it isn't JSON. */
  json(): { ok: true; value: unknown } | { ok: false } {
    if (!this.parsed) {
      try {
        this.parsed = { ok: true, value: JSON.parse(this.bodyText) };
      } catch {
        this.parsed = { ok: false };
      }
    }
    return this.parsed;
  }
}

const regexCache = new Map<string, RegExp>();
export function toRegExp(t: RegexTest): RegExp {
  const key = `${t.flags ?? ""}/${t.regex}`;
  let re = regexCache.get(key);
  if (!re) {
    re = new RegExp(t.regex, t.flags);
    regexCache.set(key, re);
  }
  return re;
}

const isRegexTest = (t: unknown): t is RegexTest => typeof t === "object" && t !== null && "regex" in t;

/** Tests a string value; `undefined` (absent) never matches. */
function testValue(test: ValueTest, actual: string | null | undefined): boolean {
  if (actual === undefined || actual === null) return false;
  return typeof test === "string" ? actual === test : toRegExp(test).test(actual);
}

function testJson(path: string, test: JsonTest, input: MatchInput): boolean {
  const body = input.json();
  let nodes: unknown[] = [];
  if (body.ok) {
    try {
      nodes = JSONPath({ path, json: body.value as object, wrap: true }) as unknown[];
    } catch {
      nodes = [];
    }
  }
  if (typeof test === "object" && test !== null && "exists" in test) return nodes.length > 0 === test.exists;
  if (isRegexTest(test)) {
    const re = toRegExp(test);
    return nodes.some((n) => (typeof n === "string" || typeof n === "number") && re.test(String(n)));
  }
  return nodes.some(
    (n) => n === test || (typeof test === "string" && (typeof n === "number" || typeof n === "boolean") && String(n) === test),
  );
}

/**
 * Scores a scenario's match rule against a request; null = does not match.
 * More criteria scores higher; among equal counts, more exact (non-regex)
 * criteria win, so `id: "404"` beats `id ~ .*`.
 */
export function scoreMatch(rule: MatchRule | undefined, input: MatchInput): number | null {
  if (!rule) return null;
  let criteria = 0;
  let exact = 0;
  const check = (ok: boolean, isExact: boolean) => {
    if (!ok) return false;
    criteria += 1;
    if (isExact) exact += 1;
    return true;
  };

  if (rule.method && rule.method !== "ANY" && !check(rule.method === input.method.toUpperCase(), true)) return null;
  for (const [k, v] of Object.entries(rule.params ?? {})) if (!check(testValue(v, input.params[k]), typeof v === "string")) return null;
  for (const [k, v] of Object.entries(rule.query ?? {})) if (!check(testValue(v, input.url.searchParams.get(k)), typeof v === "string")) return null;
  for (const [k, v] of Object.entries(rule.headers ?? {})) if (!check(testValue(v, input.headers.get(k)), typeof v === "string")) return null;
  if (rule.bodyContains !== undefined && !check(input.bodyText.toLowerCase().includes(rule.bodyContains.toLowerCase()), true)) return null;
  if (rule.bodyMatches && !check(toRegExp(rule.bodyMatches).test(input.bodyText), false)) return null;
  for (const [path, test] of Object.entries(rule.json ?? {})) if (!check(testJson(path, test, input), !isRegexTest(test))) return null;

  return criteria > 0 ? criteria * 1000 + exact : null;
}
