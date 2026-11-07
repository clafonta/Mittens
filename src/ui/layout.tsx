import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { BASE, SERVICES } from "../http/paths.js";

const css = `
:root {
  --fg:#1d1f23; --muted:#667085; --line:#e4e7ec; --line-strong:#d0d5dd; --bg:#f8f9fb; --surface:#fff; --accent:#4f46e5; --ok:#067647; --warn:#b54708; --bad:#b42318;
  /* Every button, button-like link, select and single-line input shares these. */
  --control-h:32px; --control-h-sm:26px; --control-px:12px; --control-font:14px; --radius:6px;
}
@media (prefers-color-scheme: dark) { :root { --fg:#e6e8eb; --muted:#98a2b3; --line:#2b2f36; --line-strong:#3a404a; --bg:#14161a; --surface:#1b1e23; --accent:#8b8cf8; --ok:#47cd89; --warn:#fdb022; --bad:#f97066; } }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
header { display:flex; gap:.25rem; align-items:center; padding:.6rem 1.5rem; border-bottom:1px solid var(--line); }
header a.brand { font-size:1.1rem; font-weight:700; color:var(--fg); margin-right:1rem; padding:0 .4rem; } header a.brand:hover { background:none; color:var(--accent); }
header a { display:inline-flex; align-items:center; height:var(--control-h); padding:0 .7rem; border-radius:var(--radius); color:var(--muted); text-decoration:none; }
header a:hover { color:var(--fg); background:color-mix(in srgb, var(--line) 50%, transparent); }
header a.current { color:var(--fg); background:color-mix(in srgb, var(--line) 70%, transparent); font-weight:500; }
main { padding:1.5rem; max-width:1200px; margin:0 auto; }
h1 { font-size:1.25rem; margin:0 0 1rem; } h2 { font-size:1rem; margin:2rem 0 .5rem; }
a { color:var(--accent); }
table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:.45rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:500; font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; }
code, pre { font:12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { background:color-mix(in srgb, var(--line) 40%, transparent); padding:.75rem; border-radius:6px; overflow:auto; max-height:24rem; margin:.25rem 0; white-space:pre-wrap; word-break:break-all; }
.muted { color:var(--muted); } .pill { display:inline-block; padding:0 .45rem; border-radius:999px; font-size:.75rem; border:1px solid var(--line); }
.s2 { color:var(--ok); } .s3 { color:var(--accent); } .s4 { color:var(--warn); } .s5 { color:var(--bad); }
.grid { display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; } @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.empty { padding:2rem; text-align:center; color:var(--muted); border:1px dashed var(--line); border-radius:8px; }
.banner { padding:.5rem .75rem; border:1px solid var(--warn); color:var(--warn); border-radius:6px; margin-bottom:1rem; }
.banner.live { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; padding:.5rem .5rem .5rem .75rem; } .banner.live > span { margin-right:auto; }
.flash { padding:.5rem .75rem; border:1px solid var(--ok); color:var(--ok); border-radius:6px; margin-bottom:1rem; }
.error-banner { border-color:var(--bad); color:var(--bad); }
.title-row { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; margin:0 0 1rem; min-height:var(--control-h); }
.title-row h1, .title-row h2, .title-row h3 { margin:0; margin-right:auto; display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }
.title-row > .toolbar + .toolbar, .title-row > .toolbar + .button, .title-row > .toolbar + button { margin-left:.5rem; }
.title-row:has(> h2) { margin-top:2rem; }
.scenario { border-top:1px solid var(--line); padding-top:.75rem; margin-top:.75rem; } .scenario .title-row { margin-bottom:.25rem; }
form.inline { display:inline-flex; align-items:center; margin:0; } .nowrap { white-space:nowrap; }
table.services td { vertical-align:middle; } table.services td:first-child { width:42%; } table.services td.traffic { width:1%; white-space:nowrap; padding-right:2rem; }
/* ---- sparklines */
.spark-wrap { display:inline-flex; align-items:center; gap:.5rem; vertical-align:middle; }
svg.spark { display:block; overflow:visible; } .spark .bar { fill:color-mix(in srgb, var(--accent) 60%, transparent); } .spark .bar.empty { fill:var(--line); } .spark .bar.err { fill:var(--bad); }
.flow .node .spark rect { stroke:none; } .flow .node .spark .bar { fill:color-mix(in srgb, var(--accent) 60%, transparent); } .flow .node .spark .bar.empty { fill:var(--line); } .flow .node .spark .bar.err { fill:var(--bad); }
.flow .node .count.small { font-size:11.5px; }
.service-bar .divider { width:1px; height:20px; background:var(--line-strong); margin:0 .35rem; }
.spark-total { min-width:1.5rem; font-size:.85rem; font-weight:600; color:var(--muted); font-variant-numeric:tabular-nums; }
.service-name { font-weight:500; } .small { font-size:.85rem; } code.route { font-size:.8rem; }
.service-bar { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; padding:.5rem .5rem .5rem .75rem; border:1px solid var(--line); border-radius:8px; margin:0 0 1rem; } .service-bar .spacer { flex:1; }
.match-summary { display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; margin:.4rem 0; font-size:.85rem; } code.chip { padding:.1rem .45rem; border:1px solid var(--line); border-radius:5px; background:color-mix(in srgb, var(--line) 30%, transparent); } .switcher label { color:var(--muted); }
/* ---- controls: one height, padding, font and radius for everything clickable or typeable */
.button, button, select,
input:is([type=text], [type=number], [type=search], [type=url], [type=email], [type=password], :not([type])) {
  box-sizing:border-box; height:var(--control-h); margin:0; font-family:inherit; font-size:var(--control-font); line-height:1.2;
  color:var(--fg); background-color:var(--surface); border:1px solid var(--line-strong); border-radius:var(--radius);
}
.button, button {
  display:inline-flex; align-items:center; justify-content:center; gap:.4rem; padding:0 var(--control-px);
  font-weight:500; text-decoration:none; white-space:nowrap; cursor:pointer; vertical-align:middle;
}
.button:hover, button:hover { border-color:var(--muted); }
button:disabled { opacity:.5; cursor:not-allowed; }
:is(.button, button, select, input, textarea):focus-visible { outline:2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset:1px; border-color:var(--accent); }
input:not([type=checkbox]):not([type=radio]):not([type=file]) { padding:0 .65rem; }
input[type=file] { font-family:inherit; font-size:var(--control-font); color:var(--muted); }
input[type=file]::file-selector-button { height:var(--control-h); margin-right:.75rem; padding:0 var(--control-px); font:500 var(--control-font) system-ui, sans-serif;
  color:var(--fg); background:var(--surface); border:1px solid var(--line-strong); border-radius:var(--radius); cursor:pointer; }
input[type=file]::file-selector-button:hover { border-color:var(--muted); }
input[type=search]::-webkit-search-cancel-button { cursor:pointer; }
/* Same select in every browser: no native chrome, one chevron. */
select {
  appearance:none; -webkit-appearance:none; padding:0 2rem 0 .65rem; cursor:pointer; vertical-align:middle;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23667085' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat; background-position:right .65rem center; background-size:10px 6px;
}
textarea { width:100%; font:inherit; padding:.45rem .65rem; color:var(--fg); background:var(--surface); border:1px solid var(--line-strong); border-radius:var(--radius); }
.button.sm, button.sm { height:var(--control-h-sm); padding:0 .55rem; font-size:12.5px; }
.primary { background:var(--accent); border-color:var(--accent); color:#fff; } .primary:hover { filter:brightness(1.08); border-color:var(--accent); }
.danger { color:var(--bad); } .danger:hover { border-color:var(--bad); }
.ghost { background:transparent; border-color:transparent; color:var(--accent); } .ghost:hover { border-color:transparent; background:color-mix(in srgb, var(--accent) 10%, transparent); }
/* Rows of controls. */
.toolbar { display:inline-flex; align-items:center; gap:.5rem; flex-wrap:wrap; } .toolbar.end { display:flex; justify-content:flex-end; }
.toolbar-label { display:inline-flex; align-items:center; gap:.3rem; color:var(--muted); }
/* Controls joined into one: e.g. [profile ▾][Apply]. */
.group { display:inline-flex; } .group > * { border-radius:0; } .group > * + * { margin-left:-1px; }
.group > :first-child { border-radius:var(--radius) 0 0 var(--radius); } .group > :last-child { border-radius:0 var(--radius) var(--radius) 0; }
.group > :hover, .group > :focus-visible { position:relative; z-index:1; }
/* Mutually exclusive choices that are links (filters). */
.segmented { display:inline-flex; flex-wrap:wrap; }
.segmented > a { display:inline-flex; align-items:center; height:var(--control-h); padding:0 var(--control-px); font-size:var(--control-font); color:var(--fg); text-decoration:none;
  background:var(--surface); border:1px solid var(--line-strong); margin-left:-1px; }
.segmented > a:first-child { margin-left:0; border-radius:var(--radius) 0 0 var(--radius); } .segmented > a:last-child { border-radius:0 var(--radius) var(--radius) 0; }
.segmented > a:only-child { border-radius:var(--radius); }
.segmented > a:hover { position:relative; z-index:1; border-color:var(--muted); }
.segmented > a.current { position:relative; z-index:2; background:var(--accent); border-color:var(--accent); color:#fff; font-weight:500; }
.tagbar { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; margin:0 0 1rem; }
button.changed-reset { height:var(--control-h-sm); padding:0; gap:0; overflow:hidden; border-color:color-mix(in srgb, var(--warn) 55%, var(--line)); font-size:12.5px; }
button.changed-reset > span { padding:0 .55rem; height:100%; display:inline-flex; align-items:center; }
button.changed-reset .changed-label { color:var(--warn); background:color-mix(in srgb, var(--warn) 10%, transparent); border-right:1px solid color-mix(in srgb, var(--warn) 35%, var(--line)); font-weight:500; }
button.changed-reset:hover { border-color:var(--warn); }
table.services .switcher { flex-wrap:nowrap; } table.services .switcher select[name=defaultScenario] { max-width:13rem; } .switcher .pill { white-space:nowrap; }
.pill.hook { border-color:color-mix(in srgb, var(--accent) 45%, var(--line)); color:var(--accent); }
a.pill.tag { color:inherit; text-decoration:none; } a.pill.tag:hover { border-color:var(--muted); }
.switcher { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
.actions { display:flex; align-items:center; gap:.5rem; margin-top:1.25rem; }
.field input:not([type=checkbox]), .field select { width:100%; } input.narrow { width:6.5rem; }
/* ---- home: overview cards */
.cards { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:.75rem; margin:0 0 1.25rem; } @media (max-width: 900px) { .cards { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
.card { display:flex; flex-direction:column; gap:.15rem; padding:.85rem 1rem; background:var(--surface); border:1px solid var(--line); border-radius:10px; color:var(--fg); text-decoration:none; }
.card:hover { border-color:var(--line-strong); box-shadow:0 1px 3px color-mix(in srgb, var(--fg) 8%, transparent); }
.card-label { font-size:.75rem; font-weight:500; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
.card-value { font-size:1.6rem; font-weight:650; line-height:1.2; } .card-detail { font-size:.82rem; color:var(--muted); }
.card.warn .card-value { color:var(--warn); } .card.bad .card-value { color:var(--bad); }
.empty.start { text-align:left; padding:1.5rem; } .empty.start .toolbar { margin:1rem 0; }
/* ---- home: flow diagram */
.flow { margin:0 0 1.5rem; padding:1rem 1rem .5rem; background:var(--surface); border:1px solid var(--line); border-radius:12px; }
.flow svg { display:block; width:100%; height:auto; font-family:system-ui, sans-serif; }
.flow .link { fill:none; stroke:var(--line-strong); stroke-width:1.5; } .flow .link.faint { stroke:var(--line); } .flow .link.dashed { stroke-dasharray:4 4; }
.flow .node rect { fill:var(--surface); stroke:var(--line-strong); stroke-width:1; transition:stroke .2s, fill .2s; }
.flow .node .title { font-size:13px; font-weight:600; fill:var(--fg); } .flow .node .title.big { font-size:17px; } .flow .node .title.small { font-size:12px; }
.flow .node .sub { font-size:11.5px; fill:var(--muted); } .flow .node .count { font-size:13px; font-weight:600; fill:var(--muted); font-variant-numeric:tabular-nums; }
.flow .node.mimic rect { fill:color-mix(in srgb, var(--accent) 10%, var(--surface)); stroke:var(--accent); stroke-width:1.5; }
.flow .node.app rect { fill:var(--bg); }
.flow .node.upstream rect { fill:var(--bg); stroke-dasharray:3 3; }
.flow .node.nomatch rect { fill:var(--bg); stroke:var(--line); }
.flow a.node { cursor:pointer; } .flow a.node:hover rect:first-of-type { stroke:var(--accent); }
.flow .stripe { stroke:none !important; } .flow .mode-static .stripe { fill:var(--muted); } .flow .mode-dynamic .stripe { fill:var(--accent); } .flow .mode-proxy .stripe { fill:var(--ok); } .flow .more .stripe { fill:none; }
.flow .node.inactive { opacity:.45; }
.flow .changed { fill:var(--warn); }
.flow .node.hit rect:first-of-type { animation:hit .7s ease-out; }
@keyframes hit { from { stroke:var(--accent); stroke-width:3; } to { stroke:var(--line-strong); stroke-width:1; } }
.flow .node.mimic.hit rect { animation-name:hit-mimic; } @keyframes hit-mimic { from { stroke-width:4; } to { stroke-width:1.5; } }
.flow circle.dot { stroke:var(--surface); stroke-width:1.5; filter:drop-shadow(0 0 3px color-mix(in srgb, currentColor 60%, transparent)); }
.flow circle.dot.req { fill:var(--accent); color:var(--accent); } .flow circle.dot.s2 { fill:var(--ok); color:var(--ok); } .flow circle.dot.s3 { fill:var(--accent); color:var(--accent); }
.flow circle.dot.s4 { fill:var(--warn); color:var(--warn); } .flow circle.dot.s5 { fill:var(--bad); color:var(--bad); }
.flow .node.idle { opacity:.45; }
.flow .sub.s2 { fill:var(--ok); } .flow .sub.s3 { fill:var(--accent); } .flow .sub.s4 { fill:var(--warn); } .flow .sub.s5 { fill:var(--bad); }
.flow .kind-upstream rect { fill:var(--bg); stroke-dasharray:3 3; } .flow .kind-hook rect { fill:color-mix(in srgb, var(--accent) 6%, var(--surface)); }
.flow .kind-error rect, .flow .kind-more rect { fill:var(--bg); stroke:var(--line); }
.legend { display:flex; flex-wrap:wrap; align-items:center; gap:1rem; margin-top:.5rem; font-size:.8rem; color:var(--muted); }
.legend span { display:inline-flex; align-items:center; gap:.35rem; } .legend #flow-status { margin-left:auto; }
.legend i.dot { width:9px; height:9px; border-radius:50%; display:inline-block; } .legend i.dot.req { background:var(--accent); } .legend i.dot.s2 { background:var(--ok); } .legend i.dot.s4 { background:var(--warn); } .legend i.dot.s5 { background:var(--bad); }
.legend i.line.dashed { width:18px; border-top:1.5px dashed var(--line-strong); display:inline-block; }
/* ---- AI assistants */
.assistant-panel { margin:0 0 1.25rem; border:1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius:10px; background:color-mix(in srgb, var(--accent) 6%, var(--surface)); }
.assistant-panel > summary { display:flex; align-items:center; gap:.6rem; padding:.7rem 1rem; cursor:pointer; list-style:none; border-radius:10px; }
.assistant-panel > summary::-webkit-details-marker { display:none; }
.assistant-panel > summary:hover { background:color-mix(in srgb, var(--accent) 5%, transparent); }
.assistant-panel > summary:focus-visible { outline:2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset:-2px; }
.ap-title { font-weight:600; } .ap-status { font-size:.85rem; display:inline-flex; align-items:center; gap:.35rem; }
.ap-toggle { margin-left:auto; display:inline-flex; align-items:center; gap:.45rem; font-size:.85rem; color:var(--accent); font-weight:500; }
.ap-toggle::after { content:""; width:7px; height:7px; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:translateY(-2px) rotate(45deg); transition:transform .15s; }
.assistant-panel[open] .ap-toggle::before { content:"Hide"; } .assistant-panel:not([open]) .ap-toggle::before { content:"Show"; }
.assistant-panel[open] .ap-toggle::after { transform:translateY(2px) rotate(-135deg); }
.ap-body { display:grid; grid-template-columns:minmax(15rem, 1fr) 2fr; gap:1.25rem; align-items:center; padding:.25rem 1rem 1rem; }
@media (max-width: 900px) { .ap-body { grid-template-columns:1fr; } }
.assistant-copy { line-height:1.5; } .assistant-copy p { margin:0 0 .55rem; } .assistant-copy p:last-child { margin-bottom:0; }
/* ---- trust diagram */
.trust-diagram { margin:0; } .trust-diagram svg { display:block; width:100%; height:auto; font-family:system-ui, sans-serif; }
.trust-diagram .boundary { fill:color-mix(in srgb, var(--ok) 5%, var(--surface)); stroke:var(--ok); stroke-width:1.5; stroke-dasharray:6 5; }
.trust-diagram .boundary-label { font-size:14px; font-weight:600; fill:var(--ok); }
.trust-diagram .t-node rect { fill:var(--surface); stroke:var(--line-strong); }
.trust-diagram .t-node.mimic rect { fill:color-mix(in srgb, var(--accent) 10%, var(--surface)); stroke:var(--accent); stroke-width:1.5; }
.trust-diagram .t-node.assistant.connected rect { stroke:var(--ok); stroke-width:1.5; }
.trust-diagram .t-node.outside rect { fill:var(--bg); stroke-dasharray:3 3; }
.trust-diagram .t-title { font-size:14px; font-weight:600; fill:var(--fg); } .trust-diagram .t-title.big { font-size:18px; }
.trust-diagram .t-sub { font-size:12.5px; fill:var(--muted); } .trust-diagram .t-sub.strong { font-weight:600; fill:var(--fg); font-size:13px; }
.trust-diagram .t-label { font-size:12.5px; fill:var(--muted); } .trust-diagram .t-label.bad { fill:var(--bad); font-weight:600; }
.trust-diagram .t-link { fill:none; stroke:var(--line-strong); stroke-width:2; } .trust-diagram .t-link.local { stroke:var(--ok); }
.trust-diagram .t-link.outbound { stroke:var(--muted); stroke-dasharray:4 4; } .trust-diagram .t-link.blocked { stroke:var(--bad); stroke-dasharray:3 4; }
.trust-diagram .t-link.local.active { stroke-dasharray:6 6; animation:trust-flow 1.2s linear infinite; }
@keyframes trust-flow { to { stroke-dashoffset:-24; } }
@media (prefers-reduced-motion: reduce) { .trust-diagram .t-link.local.active { animation:none; stroke-dasharray:none; } }
.trust-diagram .t-gate circle { fill:var(--surface); stroke:var(--ok); stroke-width:2; } .trust-diagram .t-gate path { fill:none; stroke:var(--ok); stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
.trust-diagram .t-block circle { fill:var(--surface); stroke:var(--bad); stroke-width:2; } .trust-diagram .t-block path { stroke:var(--bad); stroke-width:2.2; stroke-linecap:round; }
.trust-diagram figcaption { display:flex; flex-wrap:wrap; gap:.4rem 1rem; margin-top:.35rem; font-size:.78rem; color:var(--muted); }
.trust-diagram figcaption span { display:inline-flex; align-items:center; gap:.35rem; }
.trust-diagram .sw { display:inline-block; width:18px; border-top:2px solid; } .sw.local { border-color:var(--ok); } .sw.outbound { border-top-style:dashed; border-color:var(--muted); } .sw.blocked { border-top-style:dashed; border-color:var(--bad); }
.assistants .trust-diagram { margin:0 0 1rem; padding:1rem; border:1px solid var(--line); border-radius:10px; background:var(--surface); }
.trust { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:.75rem; margin:0 0 1.25rem; } @media (max-width: 800px) { .trust { grid-template-columns:1fr; } }
.trust > div { padding:.75rem .9rem; border:1px solid var(--line); border-radius:8px; background:var(--surface); } .trust strong { display:block; margin-bottom:.2rem; } .trust p { margin:0; font-size:.88rem; color:var(--muted); line-height:1.45; } .assistant-panel .button { flex:none; }
.assistants { max-width:860px; } .assistants .lead { font-size:1rem; line-height:1.55; color:var(--fg); margin:0 0 1.25rem; }
.panel.endpoint code { font-size:13px; }
.assistant-status { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; margin:0 0 .75rem; }
table.activity td { vertical-align:middle; } table.activity code.args { font-size:11.5px; word-break:break-all; }
details.setup { border:1px solid var(--line); border-radius:8px; background:var(--surface); margin:0 0 .5rem; }
details.setup summary { cursor:pointer; padding:.7rem 1rem; list-style-position:inside; } details.setup[open] summary { border-bottom:1px solid var(--line); }
details.setup > :not(summary) { margin-left:1rem; margin-right:1rem; } details.setup > :last-child { margin-bottom:1rem; }
details.setup ol { padding-left:1.2rem; } details.setup li { margin:.6rem 0; } details.setup pre { margin:.4rem 0; }
pre.copyable { position:relative; padding-right:4.5rem; white-space:pre-wrap; word-break:break-all; } pre.copyable .copy { position:absolute; top:.4rem; right:.4rem; }
ul.prompts { list-style:none; padding:0; margin:0 0 1rem; } ul.prompts li { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.55rem .75rem; border:1px solid var(--line); border-radius:8px; background:var(--surface); margin:0 0 .4rem; }
.form { max-width:820px; } .field { margin-bottom:.9rem; flex:1; min-width:0; }
.field label { display:block; font-weight:500; margin-bottom:.2rem; }
.row, .row3 { display:flex; gap:1rem; } .row3 > * { flex:1; } @media (max-width: 700px) { .row, .row3 { flex-direction:column; gap:0; } }
input[readonly] { color:var(--muted); } textarea.mono { font:12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.field.invalid input, .field.invalid textarea { border-color:var(--bad); }
.error { color:var(--bad); font-size:.85rem; margin-top:.2rem; } .hint { color:var(--muted); font-size:.85rem; margin-top:.2rem; }
fieldset { border:1px solid var(--line); border-radius:8px; padding:.75rem 1rem; margin:0 0 1rem; } legend { padding:0 .3rem; font-weight:500; }
label.check { display:flex; align-items:center; gap:.4rem; font-weight:500; } label.check input { margin:0; }
.start-over { margin-top:2rem; } .start-over-form { gap:1rem; }
.preview { display:flex; gap:.5rem; align-items:flex-start; flex-wrap:wrap; margin:.25rem 0; } .preview textarea { flex:1; min-width:16rem; }
.panel { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; padding:.5rem .5rem .5rem .75rem; border:1px solid var(--line); border-radius:6px; margin:1rem 0; } .panel > span { margin-right:auto; }
.panel.error-banner { border-color:var(--bad); color:var(--bad); }
header .nav-help { margin-left:auto; }
a.help-link { display:inline-flex; align-items:center; justify-content:center; width:1.15rem; height:1.15rem; border-radius:50%; border:1px solid var(--line); color:var(--muted); font-size:.72rem; font-weight:600; text-decoration:none; vertical-align:middle; margin-left:.3rem; line-height:1; }
a.help-link:hover { color:var(--accent); border-color:var(--accent); }
.help { display:grid; grid-template-columns: 15rem minmax(0, 1fr); gap:2.5rem; align-items:start; }
@media (max-width: 900px) { .help { grid-template-columns: 1fr; } .help-nav { position:static; } }
.help-nav { position:sticky; top:1rem; font-size:.9rem; } .help-nav ol { padding-left:1.4rem; margin:.5rem 0; } .help-nav li { margin:.2rem 0; }
.help-nav ul { list-style:none; padding-left:.6rem; margin:.25rem 0 .5rem; border-left:2px solid var(--line); } .help-nav ul a { color:var(--muted); font-size:.85rem; }
.help-nav a { color:var(--fg); text-decoration:none; } .help-nav a:hover { color:var(--accent); } .help-nav a.current { color:var(--accent); font-weight:600; }
.prose { max-width:46rem; line-height:1.6; } .prose h1 { font-size:1.6rem; margin-bottom:1rem; } .prose h2 { font-size:1.2rem; margin:2.2rem 0 .6rem; padding-top:.4rem; } .prose h3 { font-size:1rem; margin:1.6rem 0 .4rem; }
.prose h2 .anchor, .prose h3 .anchor { margin-left:.4rem; color:var(--muted); text-decoration:none; opacity:0; } .prose h2:hover .anchor, .prose h3:hover .anchor { opacity:1; }
.prose :target { scroll-margin-top:1rem; } .prose h2:target, .prose h3:target { color:var(--accent); }
.prose p, .prose ul, .prose ol { margin:.6rem 0; } .prose li { margin:.25rem 0; }
.prose code { background:color-mix(in srgb, var(--line) 45%, transparent); padding:.05rem .3rem; border-radius:4px; } .prose pre code { background:none; padding:0; }
.prose pre { position:relative; max-height:none; white-space:pre; word-break:normal; } .prose pre .copy { position:absolute; top:.4rem; right:.4rem; height:var(--control-h-sm); padding:0 .5rem; font-size:12px; opacity:0; } .prose pre:hover .copy, .prose pre .copy:focus { opacity:1; }
.prose table { margin:.8rem 0; font-size:.92rem; } .prose th { text-transform:none; letter-spacing:0; font-size:.85rem; }
.help-search { position:relative; margin:0 0 1rem; } .help-search input { width:100%; padding-right:2rem; }
.help-search kbd { position:absolute; right:.5rem; top:calc(var(--control-h) / 2); transform:translateY(-50%); font:11px ui-monospace, monospace; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:0 .3rem; pointer-events:none; }
.help-search input:focus ~ kbd, .help-search input:not(:placeholder-shown) ~ kbd { display:none; }
#help-results:not(:empty) { margin-top:.35rem; padding:.35rem; border:1px solid var(--line); border-radius:6px; background:var(--bg); }
.help-results { list-style:none; margin:0; padding:0; } .help-results li a { display:block; padding:.3rem .4rem; border-radius:4px; font-size:.85rem; } .help-results li a:hover, .help-results li a:focus { background:color-mix(in srgb, var(--accent) 12%, transparent); }
.help-results strong { font-weight:500; } .help-results-empty { margin:.2rem .4rem; font-size:.85rem; color:var(--muted); } .help-results-all { display:block; padding:.3rem .4rem; font-size:.85rem; color:var(--accent); }
.search-results { padding-left:1.2rem; } .search-results li { margin:0 0 1rem; } .search-results p { margin:.2rem 0 0; color:var(--muted); font-size:.92rem; }
mark { background:color-mix(in srgb, var(--warn) 30%, transparent); color:inherit; border-radius:2px; padding:0 .1rem; }
.pager { display:flex; justify-content:space-between; gap:1rem; margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); }
.pager a { display:flex; flex-direction:column; text-decoration:none; } .pager a.next { text-align:right; margin-left:auto; } .pager .muted { font-size:.8rem; }
tr.inactive td { opacity:.55; } tr.inactive td:nth-child(3) { opacity:1; }
`;

/** Header sections; a page belongs to the first whose prefixes match its path. */
const NAV: { label: string; href: string; prefixes: string[]; className?: string }[] = [
  { label: "Services", href: SERVICES, prefixes: ["/services", "/import"] },
  { label: "Profiles", href: `${BASE}/profiles`, prefixes: ["/profiles"] },
  { label: "History", href: `${BASE}/history`, prefixes: ["/history"] },
  { label: "Settings", href: `${BASE}/settings`, prefixes: ["/settings"] },
  { label: "Assistants", href: `${BASE}/assistants`, prefixes: ["/assistants"] },
  { label: "Help", href: `${BASE}/help`, prefixes: ["/help"], className: "nav-help" },
];

function currentSection(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const rest = path.startsWith(BASE) ? path.slice(BASE.length) : path;
  return NAV.find((n) => n.prefixes.some((p) => rest === p || rest.startsWith(`${p}/`)))?.label;
}

export function Layout(props: { title: string; readOnly: boolean; flash?: string; reloadError?: string; path?: string; children: Child }) {
  const current = currentSection(props.path);
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · Mimic`}</title>
        {/* raw: JSX would escape quotes and ">" inside the CSS and break those rules. */}
        <style>{raw(css)}</style>
        <link rel="icon" type="image/svg+xml" href={`${BASE}/assets/favicon.svg`} />
        <script src={`${BASE}/assets/htmx.min.js`} defer></script>
      </head>
      <body>
        <header>
          <a class="brand" href={BASE} aria-current={current === undefined && props.path !== undefined && /^\/_mimic\/?$/.test(props.path) ? "page" : undefined}>
            Mimic
          </a>
          {NAV.map((n) => (
            <a
              href={n.href}
              class={[n.className, n.label === current ? "current" : undefined].filter(Boolean).join(" ") || undefined}
              aria-current={n.label === current ? "page" : undefined}
            >
              {n.label}
            </a>
          ))}
        </header>
        <main>
          {props.readOnly && <div class="banner">Read-only mode: changes are kept in memory and not saved to disk.</div>}
          {props.reloadError && (
            <div class="banner error-banner" role="alert">
              <strong>Couldn't reload definitions from disk.</strong> Still serving the last good version.
              <pre>{props.reloadError}</pre>
            </div>
          )}
          {props.flash && (
            <div class="flash" role="status">
              {props.flash}
            </div>
          )}
          {props.children}
        </main>
      </body>
    </html>
  );
}

export const StatusCode = ({ status }: { status: number }) => (
  <span class={`s${String(status)[0]}`}>{status}</span>
);
