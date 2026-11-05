export interface CompiledPath {
  template: string;
  regex: RegExp;
  paramNames: string[];
  /** Higher = more specific. Used to order candidate services. */
  specificity: number;
}

/** Param names: letters, digits, _ and - (OpenAPI specs often use {user-id}). */
const NAME = "[A-Za-z_][A-Za-z0-9_-]*";
const PARAM_WHOLE = new RegExp(`^\\{(${NAME})\\}$`);
const PARAM_ANY = new RegExp(`\\{${NAME}\\}`);
const PARAM_GLOBAL = new RegExp(`\\{(${NAME})\\}`, "g");

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compiles a path template such as `/api/users/{id}` or `/static/*`.
 * - `{name}` matches one path segment and captures it; params can also sit
 *   inside a segment (`{name}.{ext}`, `v{version}`).
 * - A trailing `/*` matches the prefix itself plus any suffix.
 */
export function compilePath(template: string): CompiledPath {
  const wildcard = template.endsWith("/*");
  const base = wildcard ? template.slice(0, -2) : template;
  const paramNames: string[] = [];
  let specificity = 0;

  const segments = base
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      const whole = PARAM_WHOLE.exec(seg);
      if (whole) {
        paramNames.push(whole[1]!);
        specificity += 1;
        return "([^/]+)";
      }
      if (!PARAM_ANY.test(seg)) {
        specificity += 10;
        return escapeRegex(seg);
      }
      // Params inside a segment, e.g. {name}.{ext} or v{version}: literal text in between.
      specificity += 5;
      let out = "";
      let last = 0;
      for (const m of seg.matchAll(PARAM_GLOBAL)) {
        out += escapeRegex(seg.slice(last, m.index)) + "([^/]+?)";
        paramNames.push(m[1]!);
        last = m.index + m[0].length;
      }
      return out + escapeRegex(seg.slice(last));
    });

  const body = segments.length ? "/" + segments.join("/") : "";
  const tail = wildcard ? "(?:/.*)?" : "/?";
  if (!wildcard) specificity += 5;

  return {
    template,
    regex: new RegExp(`^${body}${tail}$`),
    paramNames,
    specificity,
  };
}

export function matchPath(compiled: CompiledPath, path: string): Record<string, string> | null {
  const m = compiled.regex.exec(path);
  if (!m) return null;
  const params: Record<string, string> = {};
  compiled.paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(m[i + 1]!);
  });
  return params;
}
