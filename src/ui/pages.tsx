import type { HistoryEntry } from "../core/history.js";
import { validateResponse, type ValidationResult } from "../core/validate.js";
import type { Profile, ScenarioRef, Service } from "../core/schema.js";
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

const tagHref = (tag: string) => `${BASE}?tag=${encodeURIComponent(tag)}`;

/** Tag pills that link to the dashboard filtered by that tag. */
export const TagPills = ({ tags }: { tags: string[] }) => (
  <>
    {tags.map((t) => (
      <>
        {" "}
        <a class="pill tag" href={tagHref(t)}>
          {t}
        </a>
      </>
    ))}
  </>
);

/** One service row; re-rendered in place by htmx after a change. */
export function ServiceRow({ service, modified, inactive = false }: { service: Service; modified: boolean; inactive?: boolean }) {
  const formId = `svc-${service.id}`;
  return (
    <tr id={formId} class={inactive ? "inactive" : undefined}>
      <td>
        <a href={`${BASE}/services/${service.id}`}>{service.name}</a>
        <TagPills tags={service.tags} />
        {inactive && (
          <>
            {" "}
            <span class="pill s4" title="Outside the tag filter: requests to this service get a 404 (or the global error scenario).">
              not serving
            </span>
          </>
        )}
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
          </select>{" "}
          {modified && (
            <>
              <span class="pill s4" title="Differs from the YAML definition. Resets on restart.">
                changed
              </span>{" "}
              <button type="button" class="small" hx-post={`${BASE}/ui/services/${service.id}/reset`} hx-target={`#${formId}`} hx-swap="outerHTML">
                Reset
              </button>
            </>
          )}
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

/**
 * Shown when the live state differs from the definitions on disk. Always
 * renders a container so it can refresh itself after in-place row changes
 * (the row endpoints send an HX-Trigger: live-changed header).
 */
export function LiveStateBanner({ modified, returnTo }: { modified: string[]; returnTo: string }) {
  const n = modified.length;
  const refresh = {
    "hx-get": `${BASE}/ui/live-banner?return=${encodeURIComponent(returnTo)}`,
    "hx-trigger": "live-changed from:body",
    "hx-swap": "outerHTML",
  };
  if (n === 0) return <div id="live-banner" {...refresh}></div>;
  return (
    <div id="live-banner" class="banner live" role="status" {...refresh}>
      <span>
        {n} service{n === 1 ? "" : "s"} differ{n === 1 ? "s" : ""} from {n === 1 ? "its" : "their"} starting state. Live changes
        reset when Mimic restarts.
      </span>
      <form method="post" action={`${BASE}/state/save`} class="inline">
        <input type="hidden" name="return" value={returnTo} />
        <button type="submit">Save as starting state</button>
      </form>
      <form method="post" action={`${BASE}/state/reset`} class="inline">
        <input type="hidden" name="return" value={returnTo} />
        <button type="submit">Reset all</button>
      </form>
    </div>
  );
}

/** Shown while a tag filter limits which services answer requests. */
export function TagFilterBanner({ activeTags, inactive, returnTo }: { activeTags: string[]; inactive: number; returnTo: string }) {
  if (activeTags.length === 0) return null;
  return (
    <div class="banner live" role="status">
      <span>
        Only serving services tagged <strong>{activeTags.join(", ")}</strong>
        {inactive > 0 && ` · ${inactive} service${inactive === 1 ? " is" : "s are"} not answering requests`}. Live only; resets on
        restart.
      </span>
      <form method="post" action={`${BASE}/state/tags`} class="inline">
        <input type="hidden" name="tags" value="" />
        <input type="hidden" name="return" value={returnTo} />
        <button type="submit">Serve all services</button>
      </form>
    </div>
  );
}

/** Chips that filter the services table by tag (view only), plus a button to make that tag the serving filter. */
function TagBar({ tags, viewTag, activeTags }: { tags: string[]; viewTag?: string; activeTags: string[] }) {
  if (tags.length === 0) return null;
  const servingThis = viewTag !== undefined && activeTags.length === 1 && activeTags[0] === viewTag;
  return (
    <div class="tagbar">
      <span class="muted">Tags</span>
      <a class={`pill tag${viewTag === undefined ? " current" : ""}`} href={BASE}>
        all
      </a>
      {tags.map((t) => (
        <a class={`pill tag${t === viewTag ? " current" : ""}`} href={tagHref(t)}>
          {t}
        </a>
      ))}
      {viewTag !== undefined && !servingThis && (
        <form method="post" action={`${BASE}/state/tags`} class="inline">
          <input type="hidden" name="tags" value={viewTag} />
          <input type="hidden" name="return" value={tagHref(viewTag)} />
          <button type="submit" class="small" title="Services without this tag stop answering requests until you serve all again.">
            Only serve “{viewTag}”
          </button>
        </form>
      )}
    </div>
  );
}

export function ServicesPage(props: {
  services: Service[];
  profiles: ProfileInfo[];
  modified: string[];
  tags: string[];
  viewTag?: string;
  activeTags: string[];
  inactive: string[];
  totalServices: number;
}) {
  const { services, profiles, modified, viewTag } = props;
  const changed = new Set(modified);
  const inactive = new Set(props.inactive);
  const returnTo = viewTag === undefined ? BASE : tagHref(viewTag);
  return (
    <>
      <div class="title-row">
        <h1>Services</h1>
        <ProfileSwitcher profiles={profiles} />
        <a class="button" href={`${BASE}/import`}>
          Import OpenAPI
        </a>
        <a class="button primary" href={`${BASE}/services/new`}>
          New service
        </a>
      </div>
      <LiveStateBanner modified={modified} returnTo={returnTo} />
      <TagFilterBanner activeTags={props.activeTags} inactive={inactive.size} returnTo={returnTo} />
      <TagBar tags={props.tags} viewTag={viewTag} activeTags={props.activeTags} />
      {props.totalServices > 0 && services.length === 0 ? (
        <div class="empty">
          No services tagged “{viewTag}”. <a href={BASE}>Show all</a>
        </div>
      ) : services.length === 0 ? (
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
              <ServiceRow service={s} modified={changed.has(s.id)} inactive={inactive.has(s.id)} />
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

export function ServicePage(props: {
  service: Service;
  modified: boolean;
  allModified: string[];
  inactive: boolean;
  globalError?: ScenarioRef;
}) {
  const { service, modified, allModified, inactive, globalError } = props;
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
      <LiveStateBanner modified={allModified} returnTo={base} />
      {service.description && <p class="muted">{service.description}</p>}
      <table>
        <tbody>
          <ServiceRow service={service} modified={modified} inactive={inactive} />
        </tbody>
      </table>
      {service.upstream && <UpstreamInfo service={service} />}
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
              {service.errorScenario === sc.id && <span class="pill">error</span>}{" "}
              {globalError?.service === service.id && globalError.scenario === sc.id && (
                <a class="pill s5" href={`${BASE}/settings`} title="Used whenever Mimic would answer with its own error">
                  global error
                </a>
              )}
              <TagPills tags={sc.tags} />
              {sc.template && (
                <>
                  {" "}
                  <span class="pill" title="Body and headers are rendered from the request">
                    template
                  </span>
                </>
              )}
              {(() => {
                // A template's raw text isn't what clients receive, so it can't be checked statically.
                const check = sc.template ? undefined : validateResponse(service.responseSchema, sc.status, sc.body);
                return check && (
                  <>
                    {" "}
                    <ValidationPill result={check} />
                  </>
                );
              })()}
            </h3>
            <a class="button" href={`${base}/scenarios/${sc.id}/edit`}>
              Edit
            </a>
            <DeleteButton action={`${base}/scenarios/${sc.id}/delete`} what={`scenario '${sc.name}'`} />
          </div>
          {sc.match && <pre>match: {JSON.stringify(sc.match)}</pre>}
          <pre>{sc.body}</pre>
          {sc.template && <TemplatePreviewForm serviceId={service.id} scenarioId={sc.id} examplePath={service.path} />}
        </section>
      ))}
      {service.responseSchema && (
        <>
          <h2>Response schema</h2>
          <p class="muted">
            Checked against every response this service sends, for{" "}
            {Object.keys(service.responseSchema).map((k, i) => (
              <>
                {i > 0 && ", "}
                <code>{k}</code>
              </>
            ))}{" "}
            statuses. Scenarios above show whether they match.
          </p>
          <details>
            <summary>Show schema</summary>
            <pre>{JSON.stringify(service.responseSchema, null, 2)}</pre>
          </details>
        </>
      )}
      <div class="title-row">
        <h2>Requests to this service</h2>
        <ExportLinks service={service.id} />
      </div>
      <div hx-get={`${BASE}/ui/history?service=${service.id}&limit=25`} hx-trigger="load, every 2s">
        <p class="muted">Loading…</p>
      </div>
    </>
  );
}

/** Upstream URL, rewrite rules, and a box to try a path against them. */
function UpstreamInfo({ service }: { service: Service }) {
  const rules = service.rewrite ?? [];
  return (
    <>
      <p>
        Upstream: <code>{service.upstream}</code>
        {service.stripPrefix && (
          <>
            {" "}
            · strip prefix <code>{service.stripPrefix}</code>
          </>
        )}
      </p>
      {rules.length > 0 && (
        <pre>
          {rules.map((r) => `${r.from}  ->  ${r.to}`).join("\n")}
        </pre>
      )}
      <form
        class="switcher"
        hx-get={`${BASE}/ui/services/${service.id}/upstream`}
        hx-target={`#upstream-preview-${service.id}`}
        hx-trigger="submit, input changed delay:300ms from:find input"
      >
        <label for={`try-${service.id}`}>Try a path</label>
        <input id={`try-${service.id}`} name="path" type="text" placeholder="/api/users/7?x=1" />
        <span id={`upstream-preview-${service.id}`} class="muted"></span>
      </form>
    </>
  );
}

/** Renders a template scenario against a sample request, in place. */
function TemplatePreviewForm({ serviceId, scenarioId, examplePath }: { serviceId: string; scenarioId: string; examplePath: string }) {
  const target = `preview-${serviceId}-${scenarioId}`;
  return (
    <details>
      <summary>Preview with a request</summary>
      <form class="preview" hx-post={`${BASE}/ui/services/${serviceId}/scenarios/${scenarioId}/render`} hx-target={`#${target}`}>
        <input name="method" type="text" value="GET" aria-label="Method" size={6} />
        <input name="path" type="text" placeholder={examplePath.replace(/\{(\w+)\}/g, "7")} aria-label="Path and query" />
        <textarea name="body" rows={2} class="mono" placeholder='{"name":"Ada"}' aria-label="Request body"></textarea>
        <button type="submit">Render</button>
      </form>
      <div id={target}></div>
    </details>
  );
}

export const RenderedPreview = ({ status, headers, body }: { status: number; headers: Record<string, string>; body: string }) => (
  <pre>
    {status}
    {"\n"}
    {Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")}
    {Object.keys(headers).length ? "\n\n" : "\n"}
    {body}
  </pre>
);

/** Result of "Try a path": the URL proxy mode would call. */
export const UpstreamPreview = ({ url, matches }: { url: string; matches: boolean }) => (
  <>
    → <code>{url}</code>
    {!matches && <span class="s4"> (requests to this path don't reach this service)</span>}
  </>
);

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
              {e.replayOf && (
                <>
                  {" "}
                  <span class="pill">replay</span>
                </>
              )}
              {e.validation && (
                <>
                  {" "}
                  <ValidationPill result={e.validation} />
                </>
              )}
            </td>
            <td class="muted">{e.durationMs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Pass/fail marker for a schema check; the title lists the problems. */
export const ValidationPill = ({ result }: { result: ValidationResult }) =>
  result.ok ? (
    <span class="pill s2" title={`Matches the ${result.schema} schema`}>
      schema ✓
    </span>
  ) : (
    <span class="pill s5" title={result.errors.join("\n")}>
      schema ✗
    </span>
  );

const exportHref = (format: "har" | "json", filter: { service?: string; validation?: string }) => {
  const q = new URLSearchParams({ format, ...(filter.service && { service: filter.service }), ...(filter.validation && { validation: filter.validation }) });
  return `${BASE}/api/history/export?${q}`;
};

/** Download links for the current history view. */
export const ExportLinks = (filter: { service?: string; validation?: string }) => (
  <span class="switcher">
    <a class="button" href={exportHref("har", filter)} download>
      Export HAR
    </a>
    <a class="button" href={exportHref("json", filter)} download>
      Export JSON
    </a>
  </span>
);

export function HistoryPage({ validation, persistedTo, limit }: { validation?: "pass" | "fail"; persistedTo?: string; limit: number }) {
  const fragment = `${BASE}/ui/history?limit=200${validation ? `&validation=${validation}` : ""}`;
  return (
    <>
      <div class="title-row">
        <h1>History</h1>
        <span class="switcher">
          <a class={`pill tag${validation ? "" : " current"}`} href={`${BASE}/history`}>
            all
          </a>
          <a class={`pill tag${validation === "fail" ? " current" : ""}`} href={`${BASE}/history?validation=fail`}>
            schema failures
          </a>
        </span>
        <ExportLinks validation={validation} />
        <button hx-delete={`${BASE}/api/history`} hx-swap="none" hx-confirm="Clear all history?">
          Clear history
        </button>
      </div>
      <p class="muted">
        {persistedTo ? (
          <>
            Keeps the latest {limit} requests, saved to <code>{persistedTo}</code> so they survive restarts.
          </>
        ) : (
          <>
            Keeps the latest {limit} requests in memory; they're gone when Mimic restarts (use <code>--persist-history</code> to keep
            them).
          </>
        )}
      </p>
      <div hx-get={fragment} hx-trigger="load, every 2s">
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

function ValidationDetail({ result }: { result: ValidationResult }) {
  if (result.ok)
    return (
      <p class="s2">
        Response matches the service's <code>{result.schema}</code> schema.
      </p>
    );
  return (
    <div class="banner error-banner">
      Response doesn't match the service's <code>{result.schema}</code> schema:
      <ul>
        {result.errors.map((e) => (
          <li>
            <code>{e}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How a replay's response compares with the original's. */
function ReplayComparison({ entry, original }: { entry: HistoryEntry; original?: HistoryEntry }) {
  if (!entry.replayOf) return null;
  if (!original) return <p class="muted">Replay of a request that is no longer in history.</p>;
  const differences = [
    original.response.status !== entry.response.status && (
      <>
        status <StatusCode status={original.response.status} /> → <StatusCode status={entry.response.status} />
      </>
    ),
    original.response.body !== entry.response.body && "body",
    (original.serviceId !== entry.serviceId || original.scenarioId !== entry.scenarioId) &&
      `answered by ${[entry.serviceId, entry.scenarioId].filter(Boolean).join(" / ") || "nothing"} (was ${[original.serviceId, original.scenarioId].filter(Boolean).join(" / ") || "nothing"})`,
  ].filter(Boolean);
  return (
    <p>
      Replay of <a href={`${BASE}/history/${original.id}`}>an earlier request</a>.{" "}
      {differences.length === 0 ? (
        <span class="s2">Same response as the original.</span>
      ) : (
        <span class="s4">
          Differs from the original:{" "}
          {differences.map((d, i) => (
            <>
              {i > 0 && ", "}
              {d}
            </>
          ))}
          .
        </span>
      )}
    </p>
  );
}

export function HistoryEntryPage({ entry, service, original }: { entry: HistoryEntry; service?: Service; original?: HistoryEntry }) {
  return (
    <>
      <div class="title-row">
        <h1>
          <code>
            {entry.request.method} {entry.request.path}
          </code>{" "}
          → <StatusCode status={entry.response.status} />
        </h1>
        {service &&
          (entry.response.truncated ? (
            <span class="muted">Body truncated; can't save as scenario</span>
          ) : (
            <a class="button primary" href={`${BASE}/services/${service.id}/scenarios/new?from=${entry.id}`}>
              Save as scenario
            </a>
          ))}
        {entry.request.truncated ? (
          <span class="muted">Request body truncated; can't replay</span>
        ) : (
          <form method="post" action={`${BASE}/history/${entry.id}/replay`} class="inline">
            <button type="submit" title="Send this request again through the current live state">
              Replay
            </button>
          </form>
        )}
      </div>
      <ReplayComparison entry={entry} original={original} />
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
      {entry.validation && <ValidationDetail result={entry.validation} />}
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

export interface ImportSummary {
  title: string;
  services: { id: string; method: string; path: string; name: string; scenarios: number; schema: boolean }[];
  skipped: { id: string; route: string; reason: string }[];
  warnings: string[];
}

/** OpenAPI import: upload or paste, preview, import. */
export function ImportPage(props: { values: Record<string, string>; error?: string; summary?: ImportSummary; imported?: boolean }) {
  const { values, error, summary, imported } = props;
  return (
    <>
      <h1>Import OpenAPI</h1>
      <p class="muted">
        Creates a service per operation, with a scenario per response (or per named example) and the response schemas for
        validation. Existing services are never overwritten. Also available as <code>npx @laboriouslabs/mimic import spec.yaml</code>.
      </p>
      {error && <div class="banner error-banner">{error}</div>}
      {summary && <ImportSummaryView summary={summary} imported={!!imported} />}
      {!imported && (
        <form method="post" action={`${BASE}/import`} enctype="multipart/form-data" class="form">
          <div class="field">
            <label for="f-file">Spec file (YAML or JSON)</label>
            <input id="f-file" type="file" name="file" accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml" />
          </div>
          <div class="field">
            <label for="f-spec">…or paste it</label>
            <textarea id="f-spec" name="spec" rows={10} class="mono" spellcheck={false} placeholder="openapi: 3.1.0">
              {values.spec ?? ""}
            </textarea>
          </div>
          <div class="row">
            <div class="field">
              <label for="f-mode">Starting mode</label>
              <select id="f-mode" name="mode">
                {["static", "dynamic", "proxy"].map((m) => (
                  <option value={m} selected={(values.mode || "static") === m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="f-prefix">Path prefix</label>
              <input id="f-prefix" name="prefix" type="text" value={values.prefix ?? ""} placeholder="from servers[0], e.g. /v1" />
            </div>
            <div class="field">
              <label for="f-tags">Extra tags</label>
              <input id="f-tags" name="tags" type="text" value={values.tags ?? ""} placeholder="petstore" />
            </div>
          </div>
          <div class="actions">
            <button type="submit" name="action" value="preview">
              Preview
            </button>
            <button type="submit" name="action" value="import" class="primary">
              Import
            </button>
            <a href={BASE}>Cancel</a>
          </div>
        </form>
      )}
    </>
  );
}

function ImportSummaryView({ summary, imported }: { summary: ImportSummary; imported: boolean }) {
  const n = summary.services.length;
  return (
    <section>
      <h2>
        {imported ? "Imported" : "Would import"} {n} service{n === 1 ? "" : "s"} from “{summary.title}”
      </h2>
      {n > 0 && (
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Service</th>
              <th>Scenarios</th>
            </tr>
          </thead>
          <tbody>
            {summary.services.map((s) => (
              <tr>
                <td>
                  <code>
                    {s.method} {s.path}
                  </code>
                </td>
                <td>{imported ? <a href={`${BASE}/services/${s.id}`}>{s.name}</a> : s.name} <span class="muted">({s.id})</span></td>
                <td>
                  {s.scenarios}
                  {s.schema && <span class="muted"> · schema</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {summary.skipped.length > 0 && (
        <>
          <h3>Skipped</h3>
          <ul>
            {summary.skipped.map((s) => (
              <li>
                <code>{s.route}</code> {s.id && <span class="muted">({s.id})</span>}: {s.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.warnings.map((w) => (
        <p class="hint">{w}</p>
      ))}
      {imported && (
        <p>
          <a class="button primary" href={BASE}>
            Go to services
          </a>{" "}
          <a class="button" href={`${BASE}/import`}>
            Import another
          </a>
        </p>
      )}
    </section>
  );
}

/** Project-wide settings (mimic.yaml). */
export function SettingsPage({ problems, children }: { problems: string[]; children: unknown }) {
  return (
    <>
      <h1>Settings</h1>
      <p class="muted">
        Stored in <code>mimic.yaml</code> next to <code>services/</code>.
      </p>
      {problems.map((p) => (
        <div class="banner error-banner">{p} — it is ignored until fixed.</div>
      ))}
      {children as never}
    </>
  );
}
