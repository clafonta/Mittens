export interface CompiledPath {
  template: string;
  regex: RegExp;
  paramNames: string[];
  /** Higher = more specific. Used to order candidate services. */
  specificity: number;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compiles a path template such as `/api/users/{id}` or `/static/*`.
 * - `{name}` matches one path segment and captures it.
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
      const m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(seg);
      if (m) {
        paramNames.push(m[1]!);
        specificity += 1;
        return "([^/]+)";
      }
      specificity += 10;
      return escapeRegex(seg);
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
