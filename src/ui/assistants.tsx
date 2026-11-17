import { raw } from "hono/html";
import { BASE } from "../http/paths.js";
import type { McpActivity, McpCall } from "../mcp/activity.js";
import { HelpLink } from "./help.js";
import { ControlDiagram } from "./trust.js";

export interface AssistantsData {
  /** e.g. http://localhost:4000/_mittens/mcp */
  endpoint: string;
  /** Command that starts the stdio bridge: npx, or this checkout's dist/cli.js until Mittens is published. */
  stdioCommand: { command: string; args: string[] };
  activity: McpActivity;
}

const Code = ({ children, lang }: { children: string; lang?: string }) => (
  <pre class="copyable" data-lang={lang}>
    <code>{children}</code>
  </pre>
);

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

/** Who's connected and what they've done; refreshed by htmx. */
export function AssistantActivity({ activity }: { activity: McpActivity }) {
  const calls = activity.list();
  const last = activity.lastSeen();
  return (
    <div id="assistant-activity" hx-get={`${BASE}/ui/assistants/activity`} hx-trigger="every 3s" hx-swap="outerHTML">
      <p class="assistant-status">
        {activity.client ? (
          <>
            <span class="pill s2">connected</span> <strong>{activity.client.name}</strong>
            {activity.client.version && <span class="muted"> {activity.client.version}</span>}
            {last && <span class="muted"> · last active {ago(last)}</span>}
          </>
        ) : (
          <>
            <span class="pill">waiting</span> <span class="muted">No assistant has connected yet. Follow a setup below, then ask it something.</span>
          </>
        )}
      </p>
      {calls.length > 0 && <ActivityTable calls={calls.slice(0, 25)} />}
    </div>
  );
}

function ActivityTable({ calls }: { calls: McpCall[] }) {
  return (
    <table class="activity">
      <thead>
        <tr>
          <th>Time</th>
          <th>Assistant</th>
          <th>Tool</th>
          <th>With</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {calls.map((c) => (
          <tr>
            <td class="muted nowrap">{new Date(c.at).toLocaleTimeString()}</td>
            <td class="nowrap">{c.client ?? <span class="muted">—</span>}</td>
            <td>
              <code>{c.tool}</code>
            </td>
            <td>
              <code class="muted args">{c.args}</code>
            </td>
            <td class="nowrap">{c.ok ? <span class="s2">ok · {c.ms} ms</span> : <span class="s5" title={c.error}>error: {c.error}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PROMPTS = [
  "What's mocked in Mittens right now?",
  "Make the users API fail with a 500 for every request, then put it back.",
  "Add POST /api/orders to Mittens: 201 with an order id taken from the request, and 422 when quantity is 0. Then test both.",
  "My app got a 404 for /api/users/7. Why?",
  "Import ./openapi.yaml into Mittens. Show me what you'd create before doing it.",
  "Turn the real responses I just recorded into scenarios.",
];

export function AssistantsPage({ data }: { data: AssistantsData }) {
  const { endpoint } = data;
  const stdio = [data.stdioCommand.command, ...data.stdioCommand.args, "mcp", "--url", endpoint];
  const desktop = JSON.stringify({ mcpServers: { mittens: { command: stdio[0], args: stdio.slice(1) } } }, null, 2);
  const vscode = JSON.stringify({ servers: { mittens: { type: "http", url: endpoint } } }, null, 2);
  const cursor = JSON.stringify({ mcpServers: { mittens: { url: endpoint } } }, null, 2);
  const codex = `[mcp_servers.mittens]\ncommand = ${JSON.stringify(stdio[0])}\nargs = ${JSON.stringify(stdio.slice(1))}`;

  return (
    <div class="assistants">
      <div class="title-row">
        <h1>
          AI assistants <HelpLink to="assistants" label="Help: AI assistants" />
        </h1>
      </div>
      <p class="lead">
        Let the AI assistant you already use set Mittens up for you: create mocks from a description, switch services into failure
        modes, explain why your app got a response. Mittens speaks the Model Context Protocol (MCP), so Claude, Codex, GitHub Copilot,
        Cursor and other assistants can connect to it.
      </p>
      <section class="trust" aria-label="Optional, local and in your control">
        <div>
          <strong>Optional</strong>
          <p>Nothing changes unless you connect an assistant. Everything it can do, you can also do in the dashboard; Help explains how.</p>
        </div>
        <div>
          <strong>Local</strong>
          <p>
            Mittens only accepts assistant connections from this computer, refuses requests from web pages, holds no API keys, and never
            contacts an AI service itself.
          </p>
        </div>
        <div>
          <strong>In your control</strong>
          <p>
            Assistants such as Claude Code ask before using each tool. Experiments change only the live state, which resets on restart,
            and every call is listed below.
          </p>
        </div>
      </section>
      <ControlDiagram connected={!!data.activity.client} client={data.activity.client?.name} />
      <p class="hint">
        What your assistant reads from Mittens (your mock definitions and recorded requests) is sent to the AI service it uses, as with any
        other tool it has. If History holds sensitive data from proxied traffic, clear it first or don't connect an assistant.
      </p>

      <section class="panel endpoint">
        <span>
          <span class="muted">MCP endpoint</span> <code id="mcp-endpoint">{endpoint}</code>
        </span>
        <button type="button" class="sm" data-copy="#mcp-endpoint">
          Copy
        </button>
      </section>

      <AssistantActivity activity={data.activity} />

      <h2>Connect your assistant</h2>
      <details class="setup" open>
        <summary>
          <strong>Claude Code</strong> <span class="muted">· terminal and IDE</span>
        </summary>
        <ol>
          <li>
            In your project folder, add Mittens:
            <Code>{`claude mcp add --transport http mittens ${endpoint}`}</Code>
            <span class="hint">
              To share it with your team instead, add <code>--scope project</code>: Claude Code writes it to <code>.mcp.json</code>,
              which you can commit.
            </span>
          </li>
          <li>
            Start <code>claude</code> and type <code>/mcp</code>. You should see <strong>mittens</strong> listed as connected.
          </li>
          <li>Ask it something from the list below. Each tool it uses shows up in the activity list above.</li>
        </ol>
      </details>
      <details class="setup">
        <summary>
          <strong>Claude Desktop</strong>
        </summary>
        <p>
          Settings → Developer → <em>Edit Config</em>, add this to <code>claude_desktop_config.json</code>, and restart Claude:
        </p>
        <Code lang="json">{desktop}</Code>
        <p class="hint">Claude Desktop starts local commands, so this uses Mittens's small bridge, which forwards to the running Mittens.</p>
      </details>
      <details class="setup">
        <summary>
          <strong>VS Code</strong> <span class="muted">· GitHub Copilot agent mode</span>
        </summary>
        <p>
          Create <code>.vscode/mcp.json</code> in your project, then open Copilot Chat in <em>Agent</em> mode and check that Mittens's
          tools are enabled:
        </p>
        <Code lang="json">{vscode}</Code>
      </details>
      <details class="setup">
        <summary>
          <strong>Cursor</strong>
        </summary>
        <p>
          Create <code>.cursor/mcp.json</code> in your project (or <code>~/.cursor/mcp.json</code> for every project):
        </p>
        <Code lang="json">{cursor}</Code>
      </details>
      <details class="setup">
        <summary>
          <strong>Codex CLI</strong>
        </summary>
        <p>
          Add to <code>~/.codex/config.toml</code>:
        </p>
        <Code lang="toml">{codex}</Code>
      </details>
      <details class="setup">
        <summary>
          <strong>ChatGPT</strong>
        </summary>
        <p>
          ChatGPT's connectors run in OpenAI's cloud, so they can't reach a Mittens running on your machine. To use ChatGPT you'd
          need to expose Mittens through a tunnel, which also exposes your mocks; the local assistants above don't need that.
        </p>
      </details>
      <details class="setup">
        <summary>
          <strong>Other assistants</strong>
        </summary>
        <p>Assistants that support MCP over HTTP ("Streamable HTTP") can use the endpoint above. Ones that only start local commands can run:</p>
        <Code>{stdio.join(" ")}</Code>
      </details>

      <h2>Coding agents that edit files</h2>
      <p>
        Agents working in your repository can also edit the YAML directly. <code>npx @clafonta/mittens init</code> adds an{" "}
        <code>AGENTS.md</code> to your definitions folder (and a <code>CLAUDE.md</code> pointing Claude Code at it) describing the file
        formats and how to check an edit worked. It leaves your services alone and never overwrites those files once they exist.
      </p>

      <h2>Things to try</h2>
      <ul class="prompts">
        {PROMPTS.map((p) => (
          <li>
            <span>{p}</span>
            <button type="button" class="sm" data-copy-text={p}>
              Copy
            </button>
          </li>
        ))}
      </ul>
      <p class="hint">
        Assistants change the live state for experiments (it resets when Mittens restarts) and only write your definition files when
        you ask them to create or save something. Deletions are marked so your assistant asks first.
      </p>
      <script>{raw(COPY_SCRIPT)}</script>
    </div>
  );
}

const COPY_SCRIPT = `
(function () {
  function copy(text, button) {
    navigator.clipboard.writeText(text).then(function () { var t = button.textContent; button.textContent = 'Copied'; setTimeout(function () { button.textContent = t; }, 1500); });
  }
  document.querySelectorAll('.assistants pre.copyable').forEach(function (pre) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'copy sm'; b.textContent = 'Copy';
    b.addEventListener('click', function () { copy(pre.querySelector('code').textContent, b); });
    pre.appendChild(b);
  });
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () { var el = document.querySelector(b.getAttribute('data-copy')); if (el) copy(el.textContent, b); });
  });
  document.querySelectorAll('[data-copy-text]').forEach(function (b) {
    b.addEventListener('click', function () { copy(b.getAttribute('data-copy-text'), b); });
  });
})();`;
