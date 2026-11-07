import { hostname } from "node:os";
import type { Context, Next } from "hono";

/**
 * Mimic's own pages and APIs (everything under /_mimic) are for the developer
 * on this computer. Two browser-borne attacks would otherwise reach them:
 *
 * - Cross-site requests: any web page can make the browser POST a form or a
 *   "simple" fetch to http://localhost:4000, e.g. to delete a service. So
 *   requests that change something are refused unless they come from the same
 *   origin or from a page on localhost (dev tools in your own app).
 * - DNS rebinding: a page on evil.example re-points its domain at 127.0.0.1
 *   to read or change Mimic as "same origin". So the Host header must be
 *   localhost, an IP address, or this machine's own name.
 *
 * Mock traffic (every other path) is not affected.
 */

const machine = hostname().toLowerCase();
const machineNames = new Set([machine, machine.replace(/\.local$/, ""), `${machine.replace(/\.local$/, "")}.local`]);

const bare = (h: string) => h.replace(/^\[|\]$/g, "").toLowerCase();
const isIpLiteral = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
const isLoopbackName = (h: string) => h === "localhost" || h.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(h) || h === "::1";

/** The hostname a request was addressed to (from Host, without port). */
export function requestHost(req: Request): string {
  const host = req.headers.get("host") ?? new URL(req.url).host;
  return bare(host.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1"));
}

/** Host names Mimic answers to: loopback, IP addresses (LAN use with --host), and this machine's name. */
export const isAllowedHost = (h: string) => isLoopbackName(h) || isIpLiteral(h) || machineNames.has(h);

/** Is this Origin a page on this computer's loopback address (any port)? */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackName(bare(new URL(origin).hostname));
  } catch {
    return false;
  }
}

/** Is this Origin the same as the origin the request was sent to? */
export function isSameOrigin(origin: string, req: Request): boolean {
  try {
    const o = new URL(origin);
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    return o.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Why a request to /_mimic must be refused, or undefined to let it through. */
export function refuseNonLocal(req: Request): string | undefined {
  const host = requestHost(req);
  if (!isAllowedHost(host)) return `Host '${host}' isn't allowed; open Mimic as localhost or by IP address.`;
  if (SAFE.has(req.method)) return undefined;
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === "null" || !(isSameOrigin(origin, req) || isLoopbackOrigin(origin))) {
      return `Requests from ${origin} can't change Mimic; only pages on this computer can.`;
    }
  } else if (req.headers.get("sec-fetch-site") === "cross-site") {
    return "Cross-site requests can't change Mimic.";
  }
  return undefined;
}

/** Middleware for everything under /_mimic. */
export async function localOnly(c: Context, next: Next) {
  const refused = refuseNonLocal(c.req.raw);
  if (refused) return c.json({ error: refused }, 403);
  return next();
}

/**
 * CORS for Mimic's management API, for pages on localhost (e.g. a dev panel
 * in the app under development, on another port). Other origins get no CORS
 * headers, so browsers won't let them read anything.
 */
export async function localCors(c: Context, next: Next) {
  const origin = c.req.header("origin");
  const allowed = !!origin && isLoopbackOrigin(origin) && !isSameOrigin(origin, c.req.raw);
  if (allowed && c.req.method === "OPTIONS" && c.req.header("access-control-request-method")) {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
        "access-control-allow-headers": c.req.header("access-control-request-headers") ?? "content-type",
        "access-control-max-age": "600",
        vary: "Origin",
      },
    });
  }
  await next();
  if (allowed) {
    c.res.headers.set("access-control-allow-origin", origin);
    c.res.headers.append("vary", "Origin");
  }
}
