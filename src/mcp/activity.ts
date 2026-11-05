/** One tool call made by an AI assistant, for the dashboard's activity list. */
export interface McpCall {
  at: string;
  client?: string;
  tool: string;
  /** Short, single-line summary of the arguments. */
  args: string;
  ok: boolean;
  ms: number;
  error?: string;
}

const summarizeArgs = (args: unknown) => {
  const text = JSON.stringify(args ?? {});
  return text === "{}" ? "" : text.length > 120 ? `${text.slice(0, 117)}…` : text;
};

/**
 * What assistants have been doing: the latest calls and the last client that
 * connected. In memory only. The endpoint is stateless, so the client name
 * comes from the most recent `initialize`.
 */
export class McpActivity {
  private calls: McpCall[] = [];
  client: { name: string; version?: string; at: string } | undefined;

  constructor(private readonly limit = 100) {}

  connected(name: string, version?: string) {
    this.client = { name, version, at: new Date().toISOString() };
  }

  record(call: { tool: string; args: unknown; ok: boolean; ms: number; error?: string }) {
    this.calls.unshift({
      at: new Date().toISOString(),
      client: this.client?.name,
      tool: call.tool,
      args: summarizeArgs(call.args),
      ok: call.ok,
      ms: call.ms,
      ...(call.error && { error: call.error.split("\n")[0]!.slice(0, 200) }),
    });
    if (this.calls.length > this.limit) this.calls.length = this.limit;
  }

  list(): McpCall[] {
    return [...this.calls];
  }

  /** When an assistant last did anything (initialize or tool call). */
  lastSeen(): string | undefined {
    const latest = [this.client?.at, this.calls[0]?.at].filter((x): x is string => !!x).sort();
    return latest.at(-1);
  }
}
