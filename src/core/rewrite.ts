import type { Service } from "./schema.js";

/**
 * Path that proxy mode sends upstream: `stripPrefix` is removed first, then
 * each `rewrite` rule is applied in order (a regex replace on the path, so
 * `$1` refers to capture groups). The query string is passed through as is.
 */
export function upstreamPath(service: Pick<Service, "stripPrefix" | "rewrite">, pathname: string): string {
  let path = pathname;
  const prefix = service.stripPrefix?.replace(/\/+$/, "");
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) path = path.slice(prefix.length) || "/";
  for (const rule of service.rewrite ?? []) path = path.replace(new RegExp(rule.from), rule.to);
  return path.startsWith("/") ? path : `/${path}`;
}

/** Full upstream URL for a request, or undefined when the service has no upstream. */
export function upstreamUrl(service: Pick<Service, "upstream" | "stripPrefix" | "rewrite">, url: URL): URL | undefined {
  if (!service.upstream) return undefined;
  return new URL(service.upstream.replace(/\/$/, "") + upstreamPath(service, url.pathname) + url.search);
}
