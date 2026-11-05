import type { Child } from "hono/jsx";
import { BASE } from "../http/paths.js";

const css = `
:root { --fg:#1d1f23; --muted:#667085; --line:#e4e7ec; --bg:#f8f9fb; --accent:#4f46e5; --ok:#067647; --warn:#b54708; --bad:#b42318; }
@media (prefers-color-scheme: dark) { :root { --fg:#e6e8eb; --muted:#98a2b3; --line:#2b2f36; --bg:#14161a; --accent:#8b8cf8; --ok:#47cd89; --warn:#fdb022; --bad:#f97066; } }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
header { display:flex; gap:1.5rem; align-items:center; padding:.75rem 1.5rem; border-bottom:1px solid var(--line); }
header strong { font-size:1.1rem; } header a { color:var(--muted); text-decoration:none; } header a:hover { color:var(--fg); }
main { padding:1.5rem; max-width:1200px; margin:0 auto; }
h1 { font-size:1.25rem; margin:0 0 1rem; } h2 { font-size:1rem; margin:2rem 0 .5rem; }
a { color:var(--accent); }
table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:.45rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:500; font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; }
code, pre { font:12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { background:color-mix(in srgb, var(--line) 40%, transparent); padding:.75rem; border-radius:6px; overflow:auto; max-height:24rem; margin:.25rem 0; white-space:pre-wrap; word-break:break-all; }
select, button { font:inherit; padding:.2rem .4rem; border:1px solid var(--line); border-radius:5px; background:transparent; color:inherit; }
.muted { color:var(--muted); } .pill { display:inline-block; padding:0 .45rem; border-radius:999px; font-size:.75rem; border:1px solid var(--line); }
.s2 { color:var(--ok); } .s3 { color:var(--accent); } .s4 { color:var(--warn); } .s5 { color:var(--bad); }
.grid { display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; } @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.empty { padding:2rem; text-align:center; color:var(--muted); border:1px dashed var(--line); border-radius:8px; }
.banner { padding:.5rem .75rem; border:1px solid var(--warn); color:var(--warn); border-radius:6px; margin-bottom:1rem; }
.banner.live { display:flex; align-items:center; gap:.75rem; flex-wrap:wrap; } .banner.live span { margin-right:auto; }
button.small { padding:.05rem .45rem; font-size:.8rem; }
.flash { padding:.5rem .75rem; border:1px solid var(--ok); color:var(--ok); border-radius:6px; margin-bottom:1rem; }
.error-banner { border-color:var(--bad); color:var(--bad); }
.title-row { display:flex; align-items:center; gap:.75rem; flex-wrap:wrap; margin:0 0 1rem; } .title-row h1, .title-row h2, .title-row h3 { margin:0; margin-right:auto; }
h2 + .title-row, .title-row h2 { margin-top:2rem; }
.scenario { border-top:1px solid var(--line); padding-top:.75rem; margin-top:.75rem; } .scenario .title-row { margin-bottom:.25rem; }
.button, button { display:inline-block; font:inherit; padding:.3rem .7rem; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; text-decoration:none; cursor:pointer; line-height:1.4; }
.button:hover, button:hover { border-color:var(--muted); } button:disabled { opacity:.5; cursor:not-allowed; }
.primary { background:var(--accent); border-color:var(--accent); color:#fff; } .primary:hover { filter:brightness(1.1); border-color:var(--accent); }
.danger { color:var(--bad); } .danger:hover { border-color:var(--bad); }
form.inline { display:inline; } .nowrap { white-space:nowrap; }
.switcher { display:flex; align-items:center; gap:.4rem; } .switcher label { color:var(--muted); }
.form { max-width:820px; } .field { margin-bottom:.9rem; flex:1; min-width:0; }
.field label { display:block; font-weight:500; margin-bottom:.2rem; }
.row, .row3 { display:flex; gap:1rem; } .row3 > * { flex:1; } @media (max-width: 700px) { .row, .row3 { flex-direction:column; gap:0; } }
input[type=text], input[type=number], input:not([type]), textarea, .field select { width:100%; font:inherit; padding:.4rem .5rem; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; }
input[readonly] { color:var(--muted); } textarea.mono { font:12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.field.invalid input, .field.invalid textarea { border-color:var(--bad); }
.error { color:var(--bad); font-size:.85rem; margin-top:.2rem; } .hint { color:var(--muted); font-size:.85rem; margin-top:.2rem; }
fieldset { border:1px solid var(--line); border-radius:8px; padding:.75rem 1rem; margin:0 0 1rem; } legend { padding:0 .3rem; font-weight:500; }
label.check { display:flex; align-items:center; gap:.4rem; font-weight:500; } label.check input { margin:0; }
.preview { display:flex; gap:.5rem; align-items:flex-start; flex-wrap:wrap; margin:.25rem 0; } .preview textarea { flex:1; min-width:16rem; }
.panel { display:flex; align-items:center; gap:.75rem; flex-wrap:wrap; padding:.5rem .75rem; border:1px solid var(--line); border-radius:6px; margin:1rem 0; } .panel > span { margin-right:auto; }
.panel.error-banner { border-color:var(--bad); color:var(--bad); }
.actions { display:flex; align-items:center; gap:1rem; margin-top:1rem; }
a.pill.tag { color:inherit; text-decoration:none; } a.pill.tag:hover { border-color:var(--muted); } a.pill.tag.current { background:var(--accent); border-color:var(--accent); color:#fff; }
.tagbar { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; margin:0 0 1rem; }
tr.inactive td { opacity:.55; } tr.inactive td:nth-child(3) { opacity:1; }
`;

export function Layout(props: { title: string; readOnly: boolean; flash?: string; reloadError?: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · Mimic`}</title>
        <style>{css}</style>
        <script src={`${BASE}/assets/htmx.min.js`} defer></script>
      </head>
      <body>
        <header>
          <strong>Mimic</strong>
          <a href={BASE}>Services</a>
          <a href={`${BASE}/profiles`}>Profiles</a>
          <a href={`${BASE}/history`}>History</a>
          <a href={`${BASE}/settings`}>Settings</a>
          <a href={`${BASE}/api/services`}>API</a>
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
