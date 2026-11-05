import type { HistoryEntry } from "../core/history.js";
import type { Profile, Service } from "../core/schema.js";
import { BASE } from "../http/paths.js";
import { DeleteButton } from "./forms.js";
import { StatusCode } from "./layout.js";

/** Summary of each profile for display: whether it's in effect and whether it can apply. */
export interface ProfileInfo {
  profile: Profile;
  active: boolean;
  problems: string[];
}

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

/** Compact "apply a profile" control for the dashboard. */
function ProfileSwitcher({ profiles }: { profiles: ProfileInfo[] }) {
  if (profiles.length === 0) return null;
  const active = profiles.filter((p) => p.active);
  return (
    <form method="post" action={`${BASE}/profiles/apply`} class="switcher">
      <label for="profile-switch">Profile</label>
      <select id="profile-switch" name="id">
        {active.length === 0 && <option value="">— custom —</option>}
        {profiles.map(({ profile, active, problems }) => (
          <option value={profile.id} selected={active} disabled={problems.length > 0}>
            {profile.name}
            {problems.length > 0 ? " (needs fixing)" : ""}
          </option>
        ))}
      </select>
      <input type="hidden" name="return" value={BASE} />
      <button type="submit">Apply</button>
      <a href={`${BASE}/profiles`}>Manage</a>
    </form>
  );
}

export function ServicesPage({ services, profiles }: { services: Service[]; profiles: ProfileInfo[] }) {
  return (
    <>
      <div class="title-row">
        <h1>Services</h1>
        <ProfileSwitcher profiles={profiles} />
        <a class="button primary" href={`${BASE}/services/new`}>
          New service
        </a>
      </div>
      {services.length === 0 ? (
        <div class="empty">
          No services yet. <a href={`${BASE}/services/new`}>Create one</a>, run <code>npx @laboriouslabs/mimic init</code> for
          an example, or add YAML files under <code>services/</code>.
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
  const base = `${BASE}/services/${service.id}`;
  return (
    <>
      <div class="title-row">
        <h1>{service.name}</h1>
        <a class="button" href={`${base}/edit`}>
          Edit
        </a>
        <DeleteButton action={`${base}/delete`} what={`service '${service.name}' and all its scenarios`} />
      </div>
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
      <div class="title-row">
        <h2>Scenarios</h2>
        <a class="button" href={`${base}/scenarios/new`}>
          New scenario
        </a>
      </div>
      {service.scenarios.length === 0 && <div class="empty">No scenarios yet.</div>}
      {service.scenarios.map((sc) => (
        <section class="scenario">
          <div class="title-row">
            <h3>
              {sc.name} <span class="muted">({sc.id})</span> <StatusCode status={sc.status} />{" "}
              {service.defaultScenario === sc.id && <span class="pill">default</span>}{" "}
              {service.errorScenario === sc.id && <span class="pill">error</span>}
            </h3>
            <a class="button" href={`${base}/scenarios/${sc.id}/edit`}>
              Edit
            </a>
            <DeleteButton action={`${base}/scenarios/${sc.id}/delete`} what={`scenario '${sc.name}'`} />
          </div>
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

export function ProfilesPage({ profiles }: { profiles: ProfileInfo[] }) {
  return (
    <>
      <div class="title-row">
        <h1>Profiles</h1>
        <a class="button primary" href={`${BASE}/profiles/new`}>
          New profile
        </a>
      </div>
      <p class="muted">
        A profile sets the mode and default scenario of several services at once, e.g. “happy path” or “everything fails”.
        New profiles start from the current state of all services.
      </p>
      {profiles.length === 0 ? (
        <div class="empty">No profiles yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Services</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(({ profile, active, problems }) => (
              <tr>
                <td>
                  <strong>{profile.name}</strong> <span class="muted">({profile.id})</span>{" "}
                  {active && <span class="pill s2">active</span>}
                  {profile.description && <div class="muted">{profile.description}</div>}
                  {problems.map((p) => (
                    <div class="error">{p}</div>
                  ))}
                </td>
                <td>
                  {Object.entries(profile.services).map(([id, e]) => (
                    <div>
                      <code>{id}</code>
                      <span class="muted">
                        {" "}
                        → {[e.mode, e.scenario].filter(Boolean).join(" / ") || "unchanged"}
                      </span>
                    </div>
                  ))}
                </td>
                <td class="nowrap">
                  <form method="post" action={`${BASE}/profiles/${profile.id}/apply`} class="inline">
                    <input type="hidden" name="return" value={`${BASE}/profiles`} />
                    <button type="submit" class="primary" disabled={problems.length > 0}>
                      Apply
                    </button>
                  </form>{" "}
                  <a class="button" href={`${BASE}/profiles/${profile.id}/edit`}>
                    Edit
                  </a>{" "}
                  <DeleteButton action={`${BASE}/profiles/${profile.id}/delete`} what={`profile '${profile.name}'`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Wraps a form with a page heading. */
export const FormPage = (props: { title: string; children: unknown }) => (
  <>
    <h1>{props.title}</h1>
    {props.children as never}
  </>
);

export const NotFoundPage = ({ message }: { message: string }) => (
  <>
    <h1>Not found</h1>
    <p>{message}</p>
  </>
);
