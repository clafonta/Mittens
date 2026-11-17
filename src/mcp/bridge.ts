import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * `mittens mcp`: for assistants that only launch local commands (Claude
 * Desktop, Codex…). Relays MCP messages between stdin/stdout and the running
 * Mittens's HTTP endpoint, so tools act on the server your app is talking to.
 * Diagnostics go to stderr; stdout carries only protocol messages.
 */
export async function runBridge(url: string): Promise<void> {
  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(new URL(url));
  const log = (m: string) => process.stderr.write(`mittens mcp: ${m}\n`);

  stdio.onmessage = (message: JSONRPCMessage) => {
    http.send(message).catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      log(`can't reach Mittens at ${url} (${reason}). Is it running? Start it with: npx @clafonta/mittens`);
      // Answer requests so the assistant shows an error instead of waiting.
      if ("id" in message && "method" in message) {
        void stdio.send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: `Mittens isn't reachable at ${url}. Start it with: npx @clafonta/mittens` } });
      }
    });
  };
  http.onmessage = (message) => void stdio.send(message);
  http.onerror = (err) => log(err.message);
  stdio.onclose = () => void http.close().finally(() => process.exit(0));

  await http.start();
  await stdio.start();
  log(`relaying to ${url}`);
}
