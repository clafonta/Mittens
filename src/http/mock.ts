import type { Context } from "hono";
import type { Engine } from "../core/engine.js";

const NO_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function corsHeaders(req: Request): Record<string, string> {
  return {
    "access-control-allow-origin": req.headers.get("origin") ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    "access-control-allow-headers": req.headers.get("access-control-request-headers") ?? "*",
    "access-control-expose-headers": "*",
    vary: "Origin",
  };
}

/** Handler for all mock traffic (every path outside /_mimic). */
export function mockHandler(engine: Engine) {
  return async (c: Context) => {
    const req = c.req.raw;
    // Answer CORS preflights so browser apps can call mocks from another origin.
    if (req.method === "OPTIONS" && req.headers.has("access-control-request-method")) {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    const res = await engine.handle({
      method: req.method,
      url: new URL(req.url),
      headers: req.headers,
      body: new Uint8Array(await req.arrayBuffer()),
    });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(req))) if (!headers.has(k)) headers.set(k, v);
    headers.set("x-mimic-source", res.source);
    if (res.service) headers.set("x-mimic-service", res.service.id);
    if (res.scenario) headers.set("x-mimic-scenario", res.scenario.id);
    if (res.validation) headers.set("x-mimic-validation", res.validation.ok ? "pass" : "fail");
    const noBody = NO_BODY_STATUS.has(res.status) || req.method === "HEAD";
    return new Response(noBody ? null : res.body, { status: res.status, headers });
  };
}
