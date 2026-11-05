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
`;

export function Layout(props: { title: string; readOnly: boolean; children: Child }) {
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
          <a href={`${BASE}/history`}>History</a>
          <a href={`${BASE}/api/services`}>API</a>
        </header>
        <main>
          {props.readOnly && <div class="banner">Read-only mode: changes are kept in memory and not saved to disk.</div>}
          {props.children}
        </main>
      </body>
    </html>
  );
}

export const StatusCode = ({ status }: { status: number }) => (
  <span class={`s${String(status)[0]}`}>{status}</span>
);
