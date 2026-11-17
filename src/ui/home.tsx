import { raw } from "hono/html";
import type { ServiceMode } from "../core/schema.js";
import { BASE, SERVICES } from "../http/paths.js";
import { FlowDiagram, type HomeData } from "./flow.js";
import { LiveScripts } from "./live.js";
import { ControlDiagram } from "./trust.js";
import { HelpLink } from "./help.js";
import { HistoryTable } from "./pages.js";

export type { HomeData } from "./flow.js";

// ------------------------------------------------------------------ cards

function Card({ href, label, value, detail, tone }: { href: string; label: string; value: unknown; detail?: unknown; tone?: string }) {
  return (
    <a class={`card${tone ? ` ${tone}` : ""}`} href={href}>
      <span class="card-label">{label}</span>
      <span class="card-value">{value as never}</span>
      {detail !== undefined && <span class="card-detail">{detail as never}</span>}
    </a>
  );
}

function Overview({ data }: { data: HomeData }) {
  const byMode = (m: ServiceMode) => data.services.filter((s) => s.mode === m).length;
  const errors = data.history.filter((e) => e.response.status >= 400).length;
  const failures = data.history.filter((e) => e.validation && !e.validation.ok).length;
  const n = data.services.length;
  return (
    <section class="cards" aria-label="Overview">
      <Card
        href={SERVICES}
        label="Services"
        value={n}
        detail={`${byMode("static")} static · ${byMode("dynamic")} dynamic · ${byMode("proxy")} proxy`}
      />
      <Card
        href={`${BASE}/history`}
        label="Requests"
        value={<span data-count="total">{data.history.length}</span>}
        detail={
          <>
            <span data-count="errors">{errors}</span> with errors (4xx/5xx)
          </>
        }
        tone={errors ? "warn" : undefined}
      />
      <Card
        href={`${BASE}/history?validation=fail`}
        label="Schema failures"
        value={failures}
        detail={failures ? "responses that don't match their schema" : "all checked responses match"}
        tone={failures ? "bad" : undefined}
      />
      <Card
        href={data.modified.size ? SERVICES : `${BASE}/profiles`}
        label="Live state"
        value={data.modified.size ? `${data.modified.size} changed` : "As defined"}
        detail={[
          data.activeProfile ? `Profile: ${data.activeProfile}` : "No profile active",
          data.activeTags.length ? `serving tags: ${data.activeTags.join(", ")}` : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
        tone={data.modified.size ? "warn" : undefined}
      />
    </section>
  );
}

// ------------------------------------------------------------------- page

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

/**
 * Tells people they can let an AI assistant do the setup: how to connect one,
 * or which one is connected, and whether AGENTS.md is there for coding agents.
 */
/** localStorage key for the panel's collapsed/expanded choice. */
export const PANEL_STORAGE_KEY = "mittens.assistantPanel";

/**
 * Tells people they can let an AI assistant do the setup, shows (with a
 * diagram) that it's local and in their control, and can be minimised; the
 * choice is remembered in localStorage. A <details> element, so it works
 * without JavaScript (open) and is keyboard-accessible.
 */
function AssistantPanel({ data }: { data: HomeData }) {
  const a = data.assistant;
  const agents = a?.agentsFile;
  const connected = !!a?.client;
  return (
    <>
      <details class="assistant-panel" id="assistant-panel" open>
        <summary>
          <span class="ap-title">Let your AI assistant set this up</span>
          {connected ? (
            <span class="ap-status">
              <span class="pill s2">connected</span> {a!.client!.name}
            </span>
          ) : (
            <span class="ap-status muted">optional · local · in your control</span>
          )}
          <span class="ap-toggle" aria-hidden="true"></span>
        </summary>
        <div class="ap-body">
          <div class="assistant-copy">
            {connected ? (
              <p>
                {a!.client!.name}
                {a!.lastSeen && <span class="muted"> was last active {ago(a!.lastSeen)}</span>}. Ask it things like “make the users API
                fail with a 500” or “why did my app get a 404?”
              </p>
            ) : (
              <p>
                Claude Code, Codex, GitHub Copilot, Cursor and other assistants can connect to Mittens and create mocks, switch services
                into failure modes and explain responses for you.
              </p>
            )}
            <p class="muted small">
              Optional, and you stay in control: everything here still works by hand. Mittens only accepts connections from this
              computer, holds no API keys and never contacts an AI service itself.
            </p>
            {agents && (
              <p class="muted small">
                {agents.exists ? (
                  <>
                    Coding agents that edit your definitions read <code>{agents.path}</code>.
                  </>
                ) : (
                  <>
                    Run <code>npx @clafonta/mittens init</code> to add an <code>AGENTS.md</code> that tells coding agents how to edit
                    your definitions.
                  </>
                )}
              </p>
            )}
            <p>
              <a class={`button${connected ? "" : " primary"}`} href={`${BASE}/assistants`}>
                {connected ? "Assistant activity" : "Connect your AI assistant"}
              </a>
            </p>
          </div>
          <ControlDiagram connected={connected} client={a?.client?.name} />
        </div>
      </details>
      {/* Runs as soon as the panel is parsed, so a minimised panel doesn't flash open. */}
      <script>{raw(PANEL_SCRIPT)}</script>
    </>
  );
}

const PANEL_SCRIPT = `
(function () {
  var panel = document.getElementById('assistant-panel'), KEY = '${PANEL_STORAGE_KEY}';
  if (!panel) return;
  try { if (localStorage.getItem(KEY) === 'collapsed') panel.open = false; } catch (e) {}
  panel.addEventListener('toggle', function () {
    try { localStorage.setItem(KEY, panel.open ? 'expanded' : 'collapsed'); } catch (e) {}
  });
})();`;

export function HomePage({ data }: { data: HomeData }) {
  if (data.services.length === 0) {
    return (
      <>
        <h1>Welcome to Mittens</h1>
        <div class="empty start">
          <p>
            <strong>No services yet.</strong> Mittens answers your app's API calls with responses you define, or passes them through
            to the real API and records them.
          </p>
          <p class="toolbar">
            <a class="button primary" href={`${SERVICES}/new`}>
              Create a service
            </a>
            <a class="button" href={`${BASE}/import`}>
              Import OpenAPI
            </a>
            <a class="button ghost" href={`${BASE}/help/getting-started`}>
              Getting started
            </a>
          </p>
          <p class="muted small">
            Or run <code>npx @clafonta/mittens init</code> for an example.
          </p>
        </div>
        <AssistantPanel data={data} />
      </>
    );
  }
  return (
    <>
      <div class="title-row">
        <h1>
          Overview <HelpLink to="" label="Help: how Mittens works" />
        </h1>
        <span class="muted small">
          Point your app at <code>{data.origin}</code>
        </span>
      </div>
      <Overview data={data} />
      <AssistantPanel data={data} />
      <FlowDiagram data={data} />
      <div class="title-row">
        <h2>Recent activity</h2>
        <a class="button ghost" href={`${BASE}/history`}>
          All history
        </a>
      </div>
      <div hx-get={`${BASE}/ui/history?limit=8`} hx-trigger="load, every 2s">
        <HistoryTable entries={data.history.slice(0, 8)} />
      </div>
      <LiveScripts flow sparks />
    </>
  );
}

