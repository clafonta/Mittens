import { raw } from "hono/html";
import type { ServiceMode } from "../core/schema.js";
import { BASE, SERVICES } from "../http/paths.js";
import { FlowDiagram, type HomeData } from "./flow.js";
import { LiveScripts } from "./live.js";
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

export function HomePage({ data }: { data: HomeData }) {
  if (data.services.length === 0) {
    return (
      <>
        <h1>Welcome to Mimic</h1>
        <div class="empty start">
          <p>
            <strong>No services yet.</strong> Mimic answers your app's API calls with responses you define, or passes them through
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
            Or run <code>npx @clafonta/mimic init</code> for an example.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <div class="title-row">
        <h1>
          Overview <HelpLink to="" label="Help: how Mimic works" />
        </h1>
        <span class="muted small">
          Point your app at <code>{data.origin}</code>
        </span>
      </div>
      <Overview data={data} />
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

