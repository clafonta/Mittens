import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context } from "hono";
import { createMcpServer, type McpDeps } from "./server.js";

/** Where the endpoint lives under the dashboard prefix. */
export const MCP_PATH = "/mcp";

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");

/**
 * Only local clients get in. A web page could otherwise reach this endpoint
 * through the user's browser: requests from other origins are refused, and
 * the Host must be localhost or an IP address, which defeats DNS rebinding
 * (where an attacker's domain name is made to resolve to 127.0.0.1).
 */
export function refuse(req: Request): string | undefined {
  const url = new URL(req.url);
  const host = (req.headers.get("host") ?? url.host).replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "localhost" && !host.endsWith(".localhost") && !isIp(host)) {
    return `Host '${host}' isn't allowed; connect to Mimic as localhost or by IP address.`;
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    const o = new URL(origin);
    const sameHost = o.hostname.replace(/^\[|\]$/g, "").toLowerCase() === host && (o.port || "80") === (url.port || "80");
    if (!sameHost) return `Requests from ${origin} aren't allowed.`;
  }
  return undefined;
}

/** Remembers which assistant connected, from the initialize message. */
async function noteClient(req: Request, deps: McpDeps) {
  if (req.method !== "POST") return;
  try {
    const body = (await req.clone().json()) as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } } | unknown[];
    const messages = Array.isArray(body) ? body : [body];
    for (const m of messages as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } }[]) {
      if (m?.method === "initialize" && m.params?.clientInfo?.name) deps.activity.connected(m.params.clientInfo.name, m.params.clientInfo.version);
    }
  } catch {
    // not JSON: the transport will reply with a proper error
  }
}

/**
 * Streamable HTTP MCP endpoint. Stateless: each request gets a fresh server
 * and transport, and tools act directly on the running Mimic.
 */
export function mcpHandler(deps: McpDeps) {
  return async (c: Context) => {
    const req = c.req.raw;
    const refused = refuse(req);
    if (refused) return c.json({ jsonrpc: "2.0", error: { code: -32000, message: refused }, id: null }, 403);
    await noteClient(req, deps);
    const origin = new URL(req.url).origin;
    const server = createMcpServer(deps, origin);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      void server.close();
    }
  };
}
