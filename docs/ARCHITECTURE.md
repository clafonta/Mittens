# Architecture

## Goals

- **Local-first.** `npx @clafonta/mimic` and go. No database server, no cloud, no build step for users.
- **Definitions are code.** Human-readable YAML in the repo, one file per service/scenario, clean diffs.
- **One process, one port.** Mock traffic, dashboard and API are served together.
- **Scriptable from tests.** Everything the UI does is available over a JSON API.

This is a clean break from Mockey: no XML import, new file format, new URL layout.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22.19+ | `npx` distribution; built-in `fetch` and `parseArgs`. History persistence uses JSON Lines rather than `node:sqlite`, which still prints an experimental warning on Node 22 |
| HTTP | Hono + `@hono/node-server` | Small, fast, Web-standard `Request`/`Response`; trivial in-process testing via `app.request()` |
| UI | Server-rendered Hono JSX + htmx | No client build or bundler; types shared with the server; partial updates and polling via attributes. Rich widgets (e.g. a JSON editor) can be added later as isolated islands |
| Upstream proxying | `undici` (`EnvHttpProxyAgent`) | Built-in `fetch` ignores `HTTP(S)_PROXY`; undici's agent honours them and `NO_PROXY`, with tunnelling for HTTPS. Only used when a proxy is configured |
| Validation | Zod 4 | One schema for files, API input and TS types |
| JSONPath | `jsonpath-plus` | Full JSONPath incl. filters; filter expressions run in its sandboxed evaluator, not `eval` |
| Response schemas | Ajv 8 + ajv-formats | The standard JSON Schema validator; compiled once per schema and cached |
| Storage | YAML files (`yaml`) | Git-friendly; block scalars keep bodies readable |
| Tests | Vitest | Fast; tests hit the real Hono app in-process |
| Build | `tsc` → `dist/` | Plain ESM output; no bundler needed |

## Layout

```
src/
  cli.ts            arg parsing, `init`, `import`, server start
  init.ts           example definitions
  index.ts          public types (hook API) exported by the package
  version.ts        package version
  help.ts           docs/help/*.md → HTML for the in-app help (anchors, links, live origin)
  core/
    schema.ts       Zod schemas + types (Service, Scenario, MatchRule, Profile, Settings)
    path.ts         path templates → regex, specificity ranking
    repo.ts         Repo interface; FileRepo (YAML tree, atomic writes), MemoryRepo (tests)
    store.ts        definitions, profiles, settings (write-through to Repo); live state; tag filter
    engine.ts       resolve request → hook / scenario / proxy response; templates; validate; delay; record
    match.ts        dynamic-mode scoring: exact, regex and JSONPath criteria
    template.ts     {{ }} response templates: parse (on save) and render
    hooks.ts        load and run services/<id>/hook.*; hook types
    validate.ts     responseSchema checks (Ajv, 2020-12 / draft-07)
    rewrite.ts      stripPrefix / rewrite → upstream URL
    upstream.ts     HTTP(S)_PROXY support for proxy-mode calls (undici)
    openapi.ts      OpenAPI 3 → import plan → services
    history.ts      bounded in-memory request log (event emitter)
    history-file.ts optional JSON Lines persistence for history
    har.ts          history → HAR 1.2
    record.ts       history entry -> scenario draft (headers, body, suggested match)
    watch.ts        debounced fs.watch -> Store.reload() and hook reload
  http/
    app.ts          composes the three sub-apps below
    api.ts          /_mimic/api — JSON management API
    ui.tsx          /_mimic — dashboard pages and form handlers
    mock.ts         * — mock traffic (CORS, x-mimic-* headers)
  ui/
    layout.tsx      page shell and styles
    pages.tsx       list/detail pages
    forms.tsx       service, scenario, profile and settings forms (fields take a `help` section)
    help.tsx        help pages and the "?" HelpLink
    home.tsx        home page: overview cards, flow diagram (layout + animation script)
    form-data.ts    form values <-> domain objects, Zod issues -> field errors
docs/help/          user documentation: shown in the dashboard and readable on GitHub
test/               vitest suites (+ fixtures/petstore.yaml)
scripts/smoke.mjs   pack, install the tarball in a scratch project, run the installed CLI
```

### Definitions vs live state

Definitions (YAML) are what you commit: services, scenarios, profiles, and each service's *starting* mode and default scenario. Live state is what is selected right now and exists only in memory:

- Changes **live state only**: the dashboard mode/default switcher, applying a profile (UI, API or `--profile`), `PATCH /api/state/...`, and the tag serving filter (`--tag`, "Only serve", `PUT /api/state/tags`). The tag filter is separate from per-service overrides: "Reset all" and "Save as starting state" don't touch it.
- Changes **definitions**: create/edit/delete forms, `POST/PATCH/DELETE /api/services...`, scenario and profile endpoints, the Settings page (`mimic.yaml`), and the explicit "Save as starting state" (`POST /api/state/save`).

The store keeps an override only for services whose live state differs from the definition, so "modified" is simply "has an override". Reads (`getService`, `listServices`, `resolve`) return the live view; `getDefinition` returns the file view. Editing a starting value in the service form also sets that field live, so the edit takes effect immediately; other live overrides are kept. If an edit makes an override impossible (e.g. removing the upstream of a service that is live in proxy mode) the override is dropped.

History is in memory by default; `--persist-history` adds a `HistoryFile` that appends each entry to a JSON Lines file (queued, so writes never overlap or delay responses), reloads the newest `limit` entries on start (deduplicating by id and skipping torn lines), and rewrites the file with only the in-memory entries once it reaches twice the limit.

Live state is deliberately not persisted, so restarts are predictable and CI runs never leave a dirty working tree. A git-ignored state file could be added later if people want selections to survive restarts.

### Reloading from disk

`watch.ts` watches the definitions directory recursively and, after a short debounce, calls `Store.reload()`. Reloads never overlap; events during a reload queue one more. `reload()` loads everything first and swaps only if every file is valid, so a half-finished edit never takes down a running mock: the last good definitions keep serving and `store.reloadError` is shown in the dashboard. Live overrides survive a reload unless they no longer make sense (service or scenario gone, proxy without upstream).

Mimic's own writes also trigger the watcher. They are harmless (the reload sees what is already in memory) and silent: the watcher only logs when the definitions' fingerprint actually changed. Writes go through a temp file + rename so a reload never reads a partial file; temp and dot-files are ignored. In `--read-only` mode, in-memory edits are replaced by whatever is on disk when a file changes.

### Home page and live events

The dashboard root is an overview: cards (services by mode, requests and errors, schema failures, live state), a flow diagram, and recent activity. The diagram is server-rendered SVG with a deterministic layout (`layoutDiagram` in `ui/home.tsx`): your app → Mimic → up to ten services (the rest share a "+N more" node) → one node per upstream host, plus a "No match" node. Each link is a `<path>` with a known id, so the page's small script can animate along it with `getPointAtLength`.

Motion is driven by real traffic only: `GET /_mimic/api/events` is a server-sent-events stream of request summaries (History emits `entry`; the handler subscribes and unsubscribes on disconnect, with a keep-alive comment every 15 s). For each event a dot travels the request's actual route and returns coloured by status; with `prefers-reduced-motion` the nodes flash instead. Without JavaScript the diagram and counts still render; the recent-activity table polls as elsewhere.

### In-app help

User documentation is Markdown in `docs/help/`, shipped in the npm package and rendered once at startup with `marked`. One source serves both places: links between topics are ordinary `other.md#section` links (rewritten to dashboard URLs), heading ids follow GitHub's anchor rules, topic order is taken from the links in `docs/help/README.md`, and examples are written against `http://localhost:4000`, which the dashboard replaces with the address it's running on. Screens link into it with `HelpLink` ("?", opens a new tab so form input isn't lost) or a field's `help` prop. Search is built from the same files: each topic is split into plain-text sections at its h2/h3 headings, and a query matches sections containing every word (words match at their start); heading matches rank above title matches above body text. Results come back as you type (htmx fragment) or as a full page on Enter, which also works without JavaScript. A test scans the source for every help reference and fails if a topic or section doesn't exist, so renaming a heading can't silently break a link.

### Templates

`template.ts` is a deliberately small language rather than Handlebars/Mustache: those HTML-escape by default (wrong for JSON) and allow arbitrary helpers. A template is parsed into text and `{{ expression | filter … }}` nodes; parsing happens when a scenario is validated (Zod refinement), and parsed templates are cached, so rendering is a walk over nodes and never throws. Values come from the same `MatchInput` used for matching (lazy JSON body parse). Rendering happens last in `Engine.resolve`, so it applies however the scenario was chosen (static, dynamic, fallback, global error), and validation sees the rendered body.

### Hooks

`hooks.ts` loads `services/<id>/hook.*` with a dynamic `import()` whose URL carries the file's mtime, so an edited hook is a new module; the old one stays in memory (fine for a dev tool, and it means a hook that fails to load can keep the previous version running). The watcher reloads hooks alongside the YAML. In the engine, the `request` hook runs after the service is matched and before its mode is applied; the `response` hook runs last, after templates, on everything except Mimic's own error responses. Both run under a 10 s timeout and any failure becomes a 500 `error` response (so the global error scenario applies), never a crash. A synchronous infinite loop can't be interrupted in-process; worker-thread isolation would fix that at the cost of serialising every request.

Hooks are on by default: they're the user's own code, like a test suite, and the CLI lists every loaded hook at startup. `--no-hooks` disables them.

### OpenAPI import

`openapi.ts` turns a document into a plan (pure; used for dry runs and previews) and `applyImport` creates services through the store, so the usual validation applies and a service that fails is reported rather than aborting the rest. `$ref`s are inlined into standalone schemas because each service's `responseSchema` is compiled on its own; cycles are cut to `{}`. Sample bodies are deterministic (fixed dates, zero UUID) so imports diff cleanly; for `oneOf`, the generator prefers a sample that matches exactly one option. Checked against GitHub's REST API description: 1,259 operations import in ~7 s, and all generated bodies pass their schemas except one whose `oneOf` can't be satisfied by any object.

### Request flow (mock traffic)

1. Answer CORS preflight if present.
2. `Store.resolve(method, path)` → most specific service that passes the tag filter, in its live state (literal > `{param}` > `/*`; exact method > `ANY`).
3. `Engine.resolve` by mode:
   - static → `defaultScenario`
   - dynamic → highest-scoring `match` (criteria count, then exact-over-regex); fallback `defaultScenario` → `errorScenario` → 404
   - proxy → `fetch(upstream + rewritten path + query)` (through the outbound proxy if configured); on error `errorScenario` → 502
   - anything that would end in Mimic's own error response (unmatched, no fallback, failed proxy, misconfigured service) uses the global error scenario from `mimic.yaml` instead, if one is set
4. Render template scenarios from the request.
5. Validate the full body against the service's `responseSchema` for that status (not for Mimic's own error responses).
6. Apply delay (scenario overrides service).
7. Record to history; respond with `x-mimic-*` headers.

## Mockey → Mimic feature map

| Mockey | Mimic | Phase |
|---|---|---|
| Services, scenarios, static/dynamic/proxy modes | Same concepts, YAML on disk | **0 (done)** |
| Hang time | `delayMs` on service/scenario | **0** |
| Dynamic match (substring / JSON rules) | Structured `match` (method, params, query, headers, bodyContains); regex values, `bodyMatches`, JSONPath `json` conditions | **0** / **2 (done)** |
| History + inspect | Live history page and API; opt-in JSONL persistence (`--persist-history`) | **0** / **2 (done)** |
| Error scenario / universal error | Per-service `errorScenario`; global error scenario in `mimic.yaml` | **0** / **1 (done)** |
| REST API (partial) | Full JSON API | **0** |
| `-p`, `-l`, `-t` (transient), `-H` | `--port`, `--dir`, `--read-only`, `--open` (opt-in) | **0** |
| Service/scenario editing in UI | Create/edit/delete forms | **1 (done)** |
| Service plans | **Profiles**: named sets of mode + scenario per service, switchable in one call; `--profile` on start | **1 (done)** |
| Tags + `-F` filter | Tag chips filter the dashboard; `--tag` / "Only serve" limits which services answer (live state) | **1 (done)** |
| History → save as scenario | "Save as scenario" from a recorded response (UI + API) | **1 (done)** |
| Redo request (`/doitagain`) | Replay from history, with a comparison to the original response | **1 (done)** |
| File watching (n/a) | Reload when YAML changes on disk; last good version kept on errors | **1 (done)** |
| Corporate proxy settings | Honour `HTTP(S)_PROXY`/`NO_PROXY` for upstream calls; `--upstream-proxy` / `--no-upstream-proxy` | **2 (done)** |
| URL twisting | `stripPrefix` + ordered regex `rewrite` rules on proxy; "Try a path" preview | **2 (done)** |
| Response JSON schema validation | `responseSchema` per status (Ajv, 2020-12 / draft-07); results in history, `x-mimic-validation`, and per-scenario on the service page | **2 (done)** |
| Stats / CSV export | History export as HAR 1.2 or JSON, filterable by service / validation | **2 (done)**; per-service counts later |
| Java request-inspector plugins | Per-service `hook.{js,mjs,ts,mts}`: `request` (answer, pick a scenario, or pass) and `response` (change any response); `ctx.state` for stateful mocks | **3 (done)** |
| Templated responses (n/a) | `template: true` scenarios: `{{params.id}}`, `{{body.x \| json}}`, helpers and filters; validated on save; preview | **3 (done)** |
| (n/a) | OpenAPI 3.0/3.1 import (CLI, API, dashboard): services, scenarios from examples or schema samples, response schemas | **3 (done)** |
| HTTPS interception, mobile view, file manager, API doc pages | Dropped unless requested | — |

## Roadmap

- **Phase 0 — foundation (done):** schemas, file store, engine with three modes, history, JSON API, dashboard with mode/default switching, CLI (`start`, `init`), tests.
- **Phase 1 — daily-driver UI (done):** CRUD forms, profiles, live state, record-to-scenario, file-watch reload, tags, replay, global error scenario.
- **Phase 2 — proxy fidelity & export (done):** corporate proxy, path rewrites, history export, schema validation, regex/JSONPath matching, history persistence.
  - Still open from this area: faithful header forwarding (`fetch` adds defaults such as `sec-fetch-mode`; `undici.request` would avoid them) and streaming large bodies instead of buffering.
- **Phase 3 — extensibility (done):** response templating, OpenAPI import, user JS hooks, and a local release gate (`prepublishOnly` runs typecheck, tests, build and a packaged-install smoke test). First publish still to do (see RELEASING.md). Not done: CI, since there is no hosted repository (only macOS has been tested), and a linter (e.g. Biome) — today `tsc --strict` is the only static check.
  - Import follow-ups: filtering by OpenAPI tag or path at import time (a full GitHub API import is 1,259 services and ~40 MB of YAML, because shared schemas are inlined per service), and re-importing to update services that came from a spec.

### UI conventions

Forms are plain HTML `POST`s (they work without JavaScript). On success the handler redirects (303) with a `?flash=` message; on failure it re-renders the form with the submitted values and per-field errors (422). Zod issue paths and `StoreError.field` map errors onto field names. htmx is used only for in-place updates (the mode/default switcher row, history polling).
