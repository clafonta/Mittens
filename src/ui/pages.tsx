import type { HistoryEntry } from "../core/history.js";
import type { Service } from "../core/schema.js";
import { BASE } from "../http/paths.js";
import { StatusCode } from "./layout.js";

const MODES = ["static", "dynamic", "proxy"] as const;

/** One service row; re-rendered in place by htmx after a change. */
export function ServiceRow({ service }: { service: Service }) {
  const formId = `svc-${service.id}`;
  return (
    <tr id={formId}>
      <td>
        <a href={`${BASE}/services/${service.id}`}>{service.name}</a>
        {service.tags.map((t) => (
          <>
            {" "}
            <span class="pill">{t}</span>
          </>
        ))}
      </td>
      <td>
        <code>
          {service.method} {service.path}
        </code>
      </td>
      <td>
        <form hx-post={`${BASE}/ui/services/${service.id}`} hx-trigger="change" hx-target={`#${formId}`} hx-swap="outerHTML">
          <select name="mode" aria-label="Mode">
            {MODES.map((m) => (
              <option value={m} selected={service.mode === m} disabled={m === "proxy" && !service.upstream}>
                {m}
              </option>
            ))}
          </select>{" "}
          <select name="defaultScenario" aria-label="Default scenario">
            <option value="">— no default —</option>
            {service.scenarios.map((s) => (
              <option value={s.id} selected={service.defaultScenario === s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </form>
      </td>
      <td class="muted">{service.scenarios.length}</td>
    </tr>
  );
}

export function ServicesPage({ services }: { services: Service[] }) {
  return (
    <>
      <h1>Services</h1>
      {services.length === 0 ? (
        <div class="empty">
          No services yet. Run <code>npx @clafonta/mimic init</code> for an example, or add YAML files under{" "}
          <code>services/</code>.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Route</th>
              <th>Mode / default scenario</th>
              <th>Scenarios</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <ServiceRow service={s} />
            ))}
          </tbody>
        </table>
      )}
      <h2>Recent requests</h2>
      <div hx-get={`${BASE}/ui/history?limit=10`} hx-trigger="load, every 2s">
        <p class="muted">Loading…</p>
      </div>
    </>
  );
}

export function ServicePage({ service }: { service: Service }) {
  return (
    <>
      <h1>{service.name}</h1>
      {service.description && <p class="muted">{service.description}</p>}
      <table>
        <tbody>
          <ServiceRow service={service} />
        </tbody>
      </table>
      {service.upstream && (
        <p>
          Upstream: <code>{service.upstream}</code>
        </p>
      )}
      <h2>Scenarios</h2>
      {service.scenarios.length === 0 && <div class="empty">No scenarios.</div>}
      {service.scenarios.map((sc) => (
        <section>
          <h3>
            {sc.name} <span class="muted">({sc.id})</span> <StatusCode status={sc.status} />
            {service.defaultScenario === sc.id && <span class="pill">default</span>}
            {service.errorScenario === sc.id && <span class="pill">error</span>}
          </h3>
          {sc.match && <pre>match: {JSON.stringify(sc.match)}</pre>}
          <pre>{sc.body}</pre>
        </section>
      ))}
      <h2>Requests to this service</h2>
      <div hx-get={`${BASE}/ui/history?service=${service.id}&limit=25`} hx-trigger="load, every 2s">
        <p class="muted">Loading…</p>
      </div>
    </>
  );
}

export function HistoryTable({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <div class="empty">No requests yet.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Request</th>
          <th>Status</th>
          <th>Service / scenario</th>
          <th>ms</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr>
            <td class="muted">{new Date(e.at).toLocaleTimeString()}</td>
            <td>
              <a href={`${BASE}/history/${e.id}`}>
                <code>
                  {e.request.method} {e.request.path}
                </code>
              </a>
            </td>
            <td>
              <StatusCode status={e.response.status} />
            </td>
            <td>
              {e.serviceName ?? <span class="muted">—</span>}
              {e.scenarioId && <span class="muted"> / {e.scenarioId}</span>} <span class="pill">{e.source}</span>
            </td>
            <td class="muted">{e.durationMs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HistoryPage() {
  return (
    <>
      <h1>History</h1>
      <p>
        <button hx-delete={`${BASE}/api/history`} hx-swap="none" hx-confirm="Clear all history?">
          Clear history
        </button>
      </p>
      <div hx-get={`${BASE}/ui/history?limit=200`} hx-trigger="load, every 2s">
        <p class="muted">Loading…</p>
      </div>
    </>
  );
}

const Headers = ({ headers }: { headers: Record<string, string> }) => (
  <pre>
    {Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") || "(none)"}
  </pre>
);

export function HistoryEntryPage({ entry }: { entry: HistoryEntry }) {
  return (
    <>
      <h1>
        <code>
          {entry.request.method} {entry.request.path}
        </code>{" "}
        → <StatusCode status={entry.response.status} />
      </h1>
      <p class="muted">
        {entry.at} · {entry.durationMs} ms · <span class="pill">{entry.source}</span>
        {entry.serviceId && (
          <>
            {" "}
            · <a href={`${BASE}/services/${entry.serviceId}`}>{entry.serviceName}</a>
          </>
        )}
        {entry.scenarioId && <> / {entry.scenarioId}</>}
      </p>
      {entry.note && <p>{entry.note}</p>}
      <div class="grid">
        <div>
          <h2>Request</h2>
          <pre>{entry.request.url}</pre>
          <Headers headers={entry.request.headers} />
          <pre>{entry.request.body || "(empty body)"}</pre>
        </div>
        <div>
          <h2>Response</h2>
          <Headers headers={entry.response.headers} />
          <pre>{entry.response.body || "(empty body)"}</pre>
        </div>
      </div>
    </>
  );
}

export const NotFoundPage = ({ message }: { message: string }) => (
  <>
    <h1>Not found</h1>
    <p>{message}</p>
  </>
);
