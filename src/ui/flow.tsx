import type { HistoryEntry } from "../core/history.js";
import type { Service, ServiceMode } from "../core/schema.js";
import type { RateSeries } from "../core/rates.js";
import { BASE, SERVICES } from "../http/paths.js";
import { SPARK_WIDTH, Sparkline } from "./spark.js";

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
  rateOf: (id: string) => RateSeries;
  /** Whether an AI assistant has connected, and whether AGENTS.md is in place, for the home page's assistant panel. */
  assistant?: {
    client?: { name: string; version?: string };
    lastSeen?: string;
    agentsFile?: { path: string; exists: boolean };
  };
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
              {clip(service.name, 18)}
            </text>
            <text x={box.x + 16} y={box.y + 40} class="sub">
              {clip(subtitle(service), 22)}
            </text>
            <Sparkline id={service.id} series={data.rateOf(service.id)} x={right(box) - 14 - SPARK_WIDTH} y={box.y + 9} label={false} />
            {data.modified.has(service.id) && (
              <circle class="changed" cx={right(box) - 46} cy={box.y + 17} r="4">
                <title>Live state differs from its definition</title>
              </circle>
            )}
            <text x={right(box) - 14} y={box.y + 44} class="count small" text-anchor="end" data-count={service.id}>
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
        <span id="flow-status" class="muted" aria-live="polite" data-live-status></span>
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------ service view

/** Most scenarios drawn individually on a service's diagram. */
export const MAX_DIAGRAM_SCENARIOS = 8;

const S_APP: Omit<Box, "y"> = { x: 16, w: 140, h: 56 };
const S_MIMIC: Omit<Box, "y"> = { x: 214, w: 140, h: 64 };
const S_SVC: Omit<Box, "y"> = { x: 420, w: 230, h: 64 };
const S_T = { x: 760, w: 330, h: 44, gap: 10 };

export type TargetKind = "upstream" | "hook" | "scenario" | "more" | "error";

export interface ServiceTarget {
  /** Element suffix: p-t-<key>, n-t-<key>, data-count="<key>". */
  key: string;
  kind: TargetKind;
  title: string;
  sub: string;
  /** Can this answer requests in the service's current mode? */
  reachable: boolean;
  status?: number;
  href?: string;
  box: Box;
  path: string;
}

/**
 * What a request to this service can end at, in the current mode: each
 * scenario, the real API, the hook, or Mimic's own error.
 */
export function serviceTargets(service: Service, opts: { requestHook: boolean }) {
  const t: Omit<ServiceTarget, "box" | "path">[] = [];
  const { mode } = service;
  if (service.upstream) {
    t.push({ key: "upstream", kind: "upstream", title: "Real API", sub: hostOf(service.upstream), reachable: mode === "proxy" });
  }
  if (opts.requestHook) t.push({ key: "hook", kind: "hook", title: "Hook", sub: "request hook can answer first", reachable: true });
  const shown = service.scenarios.slice(0, MAX_DIAGRAM_SCENARIOS);
  for (const sc of shown) {
    const isDefault = sc.id === service.defaultScenario;
    const isError = sc.id === service.errorScenario;
    const reachable =
      mode === "static" ? isDefault : mode === "dynamic" ? !!sc.match || isDefault || isError : isError;
    const roles = [isDefault && "default", isError && "error", sc.match && mode === "dynamic" && "matched by rule"].filter(Boolean);
    t.push({
      key: `sc-${sc.id}`,
      kind: "scenario",
      title: sc.name,
      sub: `${sc.status}${roles.length ? ` · ${roles.join(", ")}` : ""}`,
      reachable,
      status: sc.status,
      href: `${SERVICES}/${service.id}/scenarios/${sc.id}/edit`,
    });
  }
  const hidden = service.scenarios.length - shown.length;
  if (hidden > 0) t.push({ key: "more", kind: "more", title: `+ ${hidden} more scenario${hidden === 1 ? "" : "s"}`, sub: "", reachable: true });
  t.push({ key: "error", kind: "error", title: "Mimic error", sub: "no scenario could answer", reachable: true });
  return t;
}

export function layoutServiceDiagram(service: Service, opts: { requestHook: boolean }) {
  const raw = serviceTargets(service, opts);
  const block = raw.length * S_T.h + (raw.length - 1) * S_T.gap;
  const cy = PAD + Math.max(block, S_SVC.h) / 2;
  const app: Box = { ...S_APP, y: cy - S_APP.h / 2 };
  const mimic: Box = { ...S_MIMIC, y: cy - S_MIMIC.h / 2 };
  const svc: Box = { ...S_SVC, y: cy - S_SVC.h / 2 };
  const top = cy - block / 2;
  const targets: ServiceTarget[] = raw.map((t, i) => {
    const box: Box = { x: S_T.x, y: top + i * (S_T.h + S_T.gap), w: S_T.w, h: S_T.h };
    return { ...t, box, path: curve(right(svc), cy, box.x, midY(box)) };
  });
  return {
    height: Math.ceil(Math.max(top + block, svc.y + svc.h) + PAD),
    app,
    mimic,
    svc,
    targets,
    appPath: `M${right(app)},${cy} L${mimic.x},${cy}`,
    svcPath: `M${right(mimic)},${cy} L${svc.x},${cy}`,
  };
}

const statusTone = (s: number) => (s >= 500 ? "s5" : s >= 400 ? "s4" : s >= 300 ? "s3" : "s2");

/**
 * One service: app → Mimic → service → what can answer. Faint lines and
 * nodes can't answer in the current mode (e.g. non-default scenarios in
 * static mode). Requests to other services are ignored by the script.
 */
export function ServiceFlow(props: { service: Service; history: HistoryEntry[]; requestHook: boolean; inactive: boolean }) {
  const { service } = props;
  const l = layoutServiceDiagram(service, { requestHook: props.requestHook });
  const mine = props.history.filter((e) => e.serviceId === service.id);
  const count = (key: string) =>
    mine.filter((e) => {
      if (key === "upstream") return e.source === "proxy";
      if (key === "hook") return e.source === "hook";
      if (key === "error") return e.source === "error" || (!!e.scenarioId && !service.scenarios.some((s) => s.id === e.scenarioId));
      if (key === "more") return !!e.scenarioId && service.scenarios.slice(MAX_DIAGRAM_SCENARIOS).some((s) => s.id === e.scenarioId);
      return e.source !== "error" && e.source !== "proxy" && e.source !== "hook" && `sc-${e.scenarioId}` === key;
    }).length;

  return (
    <figure class="flow service-flow" aria-label={`How requests to ${service.name} are answered`}>
      <svg
        id="flow"
        viewBox={`0 0 ${W} ${l.height}`}
        role="img"
        aria-labelledby="flow-title"
        data-service={service.id}
        data-scenarios={service.scenarios.map((s) => s.id).join(" ")}
      >
        <title id="flow-title">
          {`Requests to ${service.name} (${service.mode} mode) and what answers them.`}
        </title>
        <path id="p-app" class="link" d={l.appPath} />
        <path id="p-svc" class={`link${props.inactive ? " faint" : ""}`} d={l.svcPath} />
        {l.targets.map((t) => (
          <path id={`p-t-${t.key}`} class={`link${t.reachable ? "" : " faint dashed"}`} d={t.path} />
        ))}

        <g class="node app">
          <rect x={l.app.x} y={l.app.y} width={l.app.w} height={l.app.h} rx="10" />
          <text x={l.app.x + l.app.w / 2} y={midY(l.app) + 5} class="title" text-anchor="middle">
            Your app
          </text>
        </g>
        <g class="node mimic" id="n-mimic">
          <rect x={l.mimic.x} y={l.mimic.y} width={l.mimic.w} height={l.mimic.h} rx="12" />
          <text x={l.mimic.x + l.mimic.w / 2} y={midY(l.mimic) + 6} class="title big" text-anchor="middle">
            Mimic
          </text>
        </g>
        <g class={`node service mode-${service.mode}${props.inactive ? " inactive" : ""}`} id="n-svc">
          <rect x={l.svc.x} y={l.svc.y} width={l.svc.w} height={l.svc.h} rx="9" />
          <rect class="stripe" x={l.svc.x} y={l.svc.y} width="4" height={l.svc.h} rx="2" />
          <text x={l.svc.x + 16} y={l.svc.y + 26} class="title">
            {clip(service.name, 22)}
          </text>
          <text x={l.svc.x + 16} y={l.svc.y + 46} class="sub">
            {`${service.mode} mode`}
          </text>
          <text x={right(l.svc) - 14} y={midY(l.svc) + 5} class="count" text-anchor="end" data-count="service">
            {mine.length}
          </text>
        </g>

        {l.targets.map((t) => {
          const body = (
            <>
              <rect x={t.box.x} y={t.box.y} width={t.box.w} height={t.box.h} rx="9" />
              <text x={t.box.x + 14} y={t.box.y + 18} class="title small">
                {clip(t.title, 34)}
              </text>
              <text x={t.box.x + 14} y={t.box.y + 34} class={`sub${t.status ? ` ${statusTone(t.status)}` : ""}`}>
                {clip(t.sub, 44)}
              </text>
              <text x={right(t.box) - 14} y={midY(t.box) + 5} class="count" text-anchor="end" data-count={t.key}>
                {count(t.key)}
              </text>
            </>
          );
          const cls = `node target kind-${t.kind}${t.reachable ? "" : " idle"}`;
          return t.href ? (
            <a href={t.href} class={cls} id={`n-t-${t.key}`}>
              {body}
            </a>
          ) : (
            <g class={cls} id={`n-t-${t.key}`}>
              {body}
            </g>
          );
        })}
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
          <i class="line dashed"></i> can't answer in {service.mode} mode
        </span>
        <span id="flow-status" class="muted" aria-live="polite" data-live-status></span>
      </figcaption>
    </figure>
  );
}

/**
 * Animates requests along the diagram as they arrive (server-sent events).
 * A dot travels app → Mimic → service (→ real API), then returns coloured by
 * status. With "reduce motion" on, the nodes just flash. Kept small and
 * dependency-free; without it the page still shows the diagram and counts.
 */
export const FLOW_SCRIPT = `
(function () {
  if (!document.getElementById('flow')) return;
  // Looked up per event: the service page re-renders the diagram when its mode changes.
  var svg = document.getElementById('flow');
  function attr(name) { svg = document.getElementById('flow') || svg; return svg.getAttribute(name) || ''; }
  var NS = 'http://www.w3.org/2000/svg';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

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


  // Service view: app → Mimic → this service → whatever answered (scenario, real API, hook, or Mimic's own error).
  function serviceRoute(r, out, back) {
    var key;
    if (r.source === 'proxy' && el('p-t-upstream')) key = 'upstream';
    else if (r.source === 'hook' && el('p-t-hook')) key = 'hook';
    else if (r.source !== 'error' && r.scenarioId && el('p-t-sc-' + r.scenarioId)) key = 'sc-' + r.scenarioId;
    else if (r.source !== 'error' && r.scenarioId && attr('data-scenarios').split(' ').indexOf(r.scenarioId) >= 0 && el('p-t-more')) key = 'more';
    else key = 'error';
    out.push([el('p-svc'), false, 'n-svc']);
    out.push([el('p-t-' + key), false, 'n-t-' + key]);
    back.push([el('p-t-' + key), true, 'n-svc']);
    back.push([el('p-svc'), true, 'n-mimic']);
    bump(key); bump('service');
    return 'n-t-' + key;
  }

  function onRequest(r) {
    var only = attr('data-service');
    if (only && r.serviceId !== only) return;
    var app = el('p-app'), out = [], back = [], target;
    if (app) out.push([app, false, 'n-mimic']);
    if (only) {
      target = serviceRoute(r, out, back);
    } else if (r.serviceId && attr('data-shown').split(' ').indexOf(r.serviceId) >= 0 && el('p-svc-' + r.serviceId)) {
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

  // Requests arrive as DOM events from the page's live connection (see live.tsx).
  document.addEventListener('mimic:request', function (ev) { try { onRequest(ev.detail); } catch (e) {} });
})();
`;
