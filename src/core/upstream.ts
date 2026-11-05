import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

/** Outbound proxy settings for upstream (proxy-mode) calls. */
export interface UpstreamProxy {
  httpProxy?: string;
  httpsProxy?: string;
  /** Comma-separated hosts, domains (.example.com), host:port, or "*". */
  noProxy?: string;
}

const pick = (env: NodeJS.ProcessEnv, name: string) => env[name.toLowerCase()] || env[name.toUpperCase()] || undefined;

/**
 * Reads the conventional proxy variables. As with curl, the lowercase form
 * wins when both are set; HTTPS_PROXY falls back to HTTP_PROXY.
 */
export function proxyFromEnv(env: NodeJS.ProcessEnv = process.env): UpstreamProxy {
  const httpProxy = pick(env, "http_proxy");
  const httpsProxy = pick(env, "https_proxy") ?? httpProxy;
  const noProxy = pick(env, "no_proxy");
  return { ...(httpProxy && { httpProxy }), ...(httpsProxy && { httpsProxy }), ...(noProxy && { noProxy }) };
}

export const usesProxy = (p: UpstreamProxy) => !!(p.httpProxy || p.httpsProxy);

/** Hides credentials, for logs. */
export function maskProxyUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password) url.password = "***";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/** Human-readable summary lines for startup output. */
export function describeProxy(p: UpstreamProxy): string {
  if (!usesProxy(p)) return "direct";
  const parts =
    p.httpProxy === p.httpsProxy
      ? [maskProxyUrl(p.httpProxy!)]
      : [p.httpProxy && `http → ${maskProxyUrl(p.httpProxy)}`, p.httpsProxy && `https → ${maskProxyUrl(p.httpsProxy)}`].filter(Boolean);
  return `${parts.join(", ")}${p.noProxy ? ` (bypass: ${p.noProxy})` : ""}`;
}

/**
 * A fetch for upstream calls that goes through the given proxy, honouring
 * NO_PROXY. Node's built-in fetch ignores proxy variables, so this uses
 * undici's EnvHttpProxyAgent. Credentials in the proxy URL
 * (http://user:pass@proxy:8080) are sent as Proxy-Authorization. For a proxy
 * that re-signs TLS, point NODE_EXTRA_CA_CERTS at its CA certificate.
 */
export function proxiedFetch(p: UpstreamProxy): typeof fetch {
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: p.httpProxy ?? "",
    httpsProxy: p.httpsProxy ?? "",
    noProxy: p.noProxy ?? "",
  });
  return ((input: string | URL, init?: RequestInit) =>
    undiciFetch(input, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;
}
