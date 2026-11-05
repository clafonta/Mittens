import { raw } from "hono/html";
import type { HistoryEntry } from "../core/history.js";
import type { Service, ServiceMode } from "../core/schema.js";
import { BASE, SERVICES } from "../http/paths.js";
import { HelpLink } from "./help.js";
import { HistoryTable } from "./pages.js";

/** What the home page needs to know, gathered by the route. */
export interface HomeData {
  services: Service[];
  modified: Set<string>;
  inactive: Set<string>;
  activeProfile?: string;
  activeTags: string[];
  history: HistoryEntry[];
  historyLimit: number;
  origin: string;
}

// ------------------------------------------------------------------ layout

/** Most services drawn individually; the rest share a "+N more" node. */
export const MAX_DIAGRAM_SERVICES = 10;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const right = (b: Box) => b.x + b.w;
const midY = (b: Box) => b.y + b.h / 2;

const W = 1120;
const PAD = 28;
const APP: Omit<Box, "y"> = { x: 16, w: 150, h: 60 };
const MIMIC: Omit<Box, "y"> = { x: 268, w: 180, h: 84 };
const SVC = { x: 560, w: 270, h: 54, gap: 12 };
const UP = { x: 940, w: 164, h: 44 };
const NOMATCH = { w: 150, h: 38, below: 54 };

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export interface DiagramLayout {
  height: number;
  app: Box;
  mimic: Box;
  nomatch: Box;
  services: { service: Service; box: Box; path: string; upstream?: { key: string; path: string; live: boolean } }[];
  more?: { count: number; box: Box; path: string };
  upstreams: { key: string; host: string; box: Box }[];
  appPath: string;
  nomatchPath: string;
}

/** Positions every node and line; deterministic, so the diagram is plain server-rendered SVG. */
export function layoutDiagram(all: Service[]): DiagramLayout {
  const shown = all.slice(0, MAX_DIAGRAM_SERVICES);
  const overflow = all.length - shown.length;
  const rows = shown.length + (overflow > 0 ? 1 : 0);
  const block = rows * SVC.h + Math.max(rows - 1, 0) * SVC.gap;
  const cy = PAD + Math.max(block, MIMIC.h) / 2;

  const mimic: Box = { ...MIMIC, y: cy - MIMIC.h / 2 };
  const app: Box = { ...APP, y: cy - APP.h / 2 };
  const nomatch: Box = { x: mimic.x + (mimic.w - NOMATCH.w) / 2, y: mimic.y + mimic.h + NOMATCH.below, w: NOMATCH.w, h: NOMATCH.h };
  const top = cy - (rows * SVC.h + Math.max(rows - 1, 0) * SVC.gap) / 2;
  const rowBox = (i: number): Box => ({ x: SVC.x, y: top + i * (SVC.h + SVC.gap), w: SVC.w, h: SVC.h });

  // One upstream node per host, next to the first service that uses it.
  const upstreams: DiagramLayout["upstreams"] = [];
  const services = shown.map((service, i) => {
    const box = rowBox(i);
    const path = curve(right(mimic), cy, box.x, midY(box));
    if (!service.upstream) return { service, box, path };
    const key = hostOf(service.upstream);
    let up = upstreams.find((u) => u.key === key);
    if (!up) {
      const prev = upstreams.at(-1);
      const y = Math.max(midY(box) - UP.h / 2, prev ? prev.box.y + prev.box.h + 10 : 0);
      up = { key, host: key, box: { ...UP, y } };
      upstreams.push(up);
    }
    return { service, box, path, upstream: { key, path: curve(right(box), midY(box), up.box.x, midY(up.box)), live: service.mode === "proxy" } };
  });
  const moreBox = overflow > 0 ? rowBox(shown.length) : undefined;
  const lowest = Math.max(top + rows * (SVC.h + SVC.gap), nomatch.y + nomatch.h, ...upstreams.map((u) => u.box.y + u.box.h));

  return {
    height: Math.ceil(lowest + PAD),
    app,
    mimic,
    nomatch,
    services,
    ...(moreBox && { more: { count: overflow, box: moreBox, path: curve(right(mimic), cy, moreBox.x, midY(moreBox)) } }),
    upstreams,
    appPath: `M${right(app)},${cy} L${mimic.x},${cy}`,
    nomatchPath: `M${mimic.x + mimic.w / 2},${mimic.y + mimic.h} L${mimic.x + mimic.w / 2},${nomatch.y}`,
  };
}

// ----------------------------------------------------------------- diagram

const MODE_LABEL: Record<ServiceMode, string> = { static: "static", dynamic: "dynamic", proxy: "proxy" };

function subtitle(s: Service): string {
  if (s.mode === "proxy") return `proxy → ${s.upstream ? hostOf(s.upstream) : "no upstream"}`;
  const def = s.scenarios.find((sc) => sc.id === s.defaultScenario);
  return `${MODE_LABEL[s.mode]}${def ? ` · ${def.name}` : s.mode === "static" ? " · no default" : ""}`;
}

/**
 * Your app → Mimic → services (→ real APIs). Each service node shows its live
 * mode and how many requests it has in history. home.js moves a dot along
 * these paths for every request that arrives.
 */
export function FlowDiagram({ data }: { data: HomeData }) {
  const l = layoutDiagram(data.services);
  const counts = new Map<string, number>();
  let unmatched = 0;
  for (const e of data.history) {
    if (e.serviceId) counts.set(e.serviceId, (counts.get(e.serviceId) ?? 0) + 1);
    else unmatched++;
  }
  const shownIds = new Set(l.services.map((s) => s.service.id));
  const moreCount = data.history.filter((e) => e.serviceId && !shownIds.has(e.serviceId)).length;

  return (
    <figure class="flow" aria-label="How requests flow through Mimic">
      <svg
        id="flow"
        viewBox={`0 0 ${W} ${l.height}`}
        role="img"
        aria-labelledby="flow-title"
        data-events={`${BASE}/api/events`}
        data-shown={[...shownIds].join(" ")}
      >
        <title id="flow-title">Requests from your app go to Mimic, which answers from each service's scenarios or proxies to the real API.</title>
        {/* lines first, so nodes sit on top */}
        <path id="p-app" class="link" d={l.appPath} />
        <path id="p-nomatch" class="link faint" d={l.nomatchPath} />
        {l.services.map(({ service, path, upstream }) => (
          <>
            <path id={`p-svc-${service.id}`} class={`link${data.inactive.has(service.id) ? " faint" : ""}`} d={path} />
            {upstream && <path id={`p-up-${service.id}`} class={`link${upstream.live ? "" : " dashed"}`} d={upstream.path} />}
          </>
        ))}
        {l.more && <path id="p-more" class="link" d={l.more.path} />}

        <g class="node app">
          <rect x={l.app.x} y={l.app.y} width={l.app.w} height={l.app.h} rx="10" />
          <text x={l.app.x + l.app.w / 2} y={midY(l.app) - 3} class="title" text-anchor="middle">
            Your app
          </text>
          <text x={l.app.x + l.app.w / 2} y={midY(l.app) + 15} class="sub" text-anchor="middle">
            browser, tests, curl…
          </text>
        </g>

        <g class="node mimic" id="n-mimic">
          <rect x={l.mimic.x} y={l.mimic.y} width={l.mimic.w} height={l.mimic.h} rx="12" />
          <text x={l.mimic.x + l.mimic.w / 2} y={midY(l.mimic) - 6} class="title big" text-anchor="middle">
            Mimic
          </text>
          <text x={l.mimic.x + l.mimic.w / 2} y={midY(l.mimic) + 16} class="sub" text-anchor="middle">
            <tspan data-count="total">{data.history.length}</tspan> requests
          </text>
        </g>

        <a href={`${BASE}/history`} class="node nomatch" id="n-nomatch">
          <rect x={l.nomatch.x} y={l.nomatch.y} width={l.nomatch.w} height={l.nomatch.h} rx="8" />
          <text x={l.nomatch.x + 12} y={midY(l.nomatch) + 4} class="sub">
            No match
          </text>
          <text x={right(l.nomatch) - 12} y={midY(l.nomatch) + 4} class="count" text-anchor="end" data-count="nomatch">
            {unmatched}
          </text>
        </a>

        {l.services.map(({ service, box }) => (
          <a
            href={`${SERVICES}/${service.id}`}
            class={`node service mode-${service.mode}${data.inactive.has(service.id) ? " inactive" : ""}`}
            id={`n-svc-${service.id}`}
          >
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="9" />
            <rect class="stripe" x={box.x} y={box.y} width="4" height={box.h} rx="2" />
            <text x={box.x + 16} y={box.y + 22} class="title">
              {clip(service.name, 26)}
            </text>
            <text x={box.x + 16} y={box.y + 40} class="sub">
              {clip(subtitle(service), 34)}
            </text>
            {data.modified.has(service.id) && (
              <circle class="changed" cx={right(box) - 46} cy={box.y + 17} r="4">
                <title>Live state differs from its definition</title>
              </circle>
            )}
            <text x={right(box) - 14} y={midY(box) + 5} class="count" text-anchor="end" data-count={service.id}>
              {counts.get(service.id) ?? 0}
            </text>
          </a>
        ))}

        {l.more && (
          <a href={SERVICES} class="node service more" id="n-more">
            <rect x={l.more.box.x} y={l.more.box.y} width={l.more.box.w} height={l.more.box.h} rx="9" />
            <text x={l.more.box.x + 16} y={midY(l.more.box) + 5} class="title">
              + {l.more.count} more service{l.more.count === 1 ? "" : "s"}
            </text>
            <text x={right(l.more.box) - 14} y={midY(l.more.box) + 5} class="count" text-anchor="end" data-count="more">
              {moreCount}
            </text>
          </a>
        )}

        {l.upstreams.map((u) => (
          <g class="node upstream" id={`n-up-${u.key}`}>
            <rect x={u.box.x} y={u.box.y} width={u.box.w} height={u.box.h} rx="9" />
            <text x={u.box.x + 12} y={u.box.y + 18} class="sub">
              Real API
            </text>
            <text x={u.box.x + 12} y={u.box.y + 34} class="title small">
              {clip(u.host, 22)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption class="legend">
        <span>
          <i class="dot req"></i> request
        </span>
        <span>
          <i class="dot s2"></i> 2xx
        </span>
        <span>
          <i class="dot s4"></i> 4xx
        </span>
        <span>
          <i class="dot s5"></i> 5xx
        </span>
        <span>
          <i class="line dashed"></i> upstream not in use (service isn't in proxy mode)
        </span>
        <span id="flow-status" class="muted" aria-live="polite"></span>
      </figcaption>
    </figure>
  );
}

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
      <script>{raw(FLOW_SCRIPT)}</script>
    </>
  );
}

/**
 * Animates requests along the diagram as they arrive (server-sent events).
 * A dot travels app → Mimic → service (→ real API), then returns coloured by
 * status. With "reduce motion" on, the nodes just flash. Kept small and
 * dependency-free; without it the page still shows the diagram and counts.
 */
const FLOW_SCRIPT = `
(function () {
  var svg = document.getElementById('flow');
  if (!svg || !window.EventSource) return;
  var NS = 'http://www.w3.org/2000/svg';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var shown = (svg.getAttribute('data-shown') || '').split(' ');
  var status = document.getElementById('flow-status');
  var live = 0, MAX_DOTS = 40, SEG_MS = 420;

  function el(id) { return document.getElementById(id); }
  function bump(key) {
    document.querySelectorAll('[data-count="' + key + '"]').forEach(function (n) {
      n.textContent = String((parseInt(n.textContent, 10) || 0) + 1);
    });
  }
  function flash(id) {
    var n = el(id); if (!n) return;
    n.classList.remove('hit'); void n.getBoundingClientRect(); n.classList.add('hit');
  }
  function tone(s) { return s >= 500 ? 's5' : s >= 400 ? 's4' : s >= 300 ? 's3' : 's2'; }

  // Move a dot along a list of [path, reversed] segments, then call done.
  function travel(segments, cls, done) {
    if (reduce || live >= MAX_DOTS || !segments.length) { done(); return; }
    live++;
    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', '5'); dot.setAttribute('class', 'dot ' + cls);
    svg.appendChild(dot);
    var i = 0, start = null;
    function frame(t) {
      var seg = segments[i], len = seg[0].getTotalLength();
      if (start === null) start = t;
      var k = Math.min((t - start) / SEG_MS, 1);
      var e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      var p = seg[0].getPointAtLength((seg[1] ? 1 - e : e) * len);
      dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
      if (k < 1) return requestAnimationFrame(frame);
      if (seg[2]) flash(seg[2]);
      i++; start = null;
      if (i < segments.length) return requestAnimationFrame(frame);
      dot.remove(); live--; done();
    }
    requestAnimationFrame(frame);
  }

  function onRequest(r) {
    var app = el('p-app'), out = [], back = [], target;
    if (app) out.push([app, false, 'n-mimic']);
    if (r.serviceId && shown.indexOf(r.serviceId) >= 0 && el('p-svc-' + r.serviceId)) {
      target = 'n-svc-' + r.serviceId;
      out.push([el('p-svc-' + r.serviceId), false, target]);
      var up = el('p-up-' + r.serviceId);
      if (r.source === 'proxy' && up) { out.push([up, false, null]); back.push([up, true, target]); }
      back.push([el('p-svc-' + r.serviceId), true, 'n-mimic']);
      bump(r.serviceId);
    } else if (r.serviceId && el('p-more')) {
      target = 'n-more';
      out.push([el('p-more'), false, target]); back.push([el('p-more'), true, 'n-mimic']); bump('more');
    } else {
      target = 'n-nomatch';
      out.push([el('p-nomatch'), false, target]); back.push([el('p-nomatch'), true, 'n-mimic']); bump('nomatch');
    }
    if (app) back.push([app, true, null]);
    bump('total');
    if (r.status >= 400) bump('errors');
    if (reduce) { flash('n-mimic'); flash(target); return; }
    travel(out, 'req', function () { travel(back, tone(r.status), function () {}); });
  }

  var es = new EventSource(svg.getAttribute('data-events'));
  es.addEventListener('request', function (m) { try { onRequest(JSON.parse(m.data)); } catch (e) {} });
  es.addEventListener('open', function () { if (status) status.textContent = 'Live'; });
  es.addEventListener('error', function () { if (status) status.textContent = 'Reconnecting…'; });
})();
`;
