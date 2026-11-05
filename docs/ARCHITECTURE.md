# Architecture

## Goals

- **Local-first.** `npx @laboriouslabs/mimic` and go. No database server, no cloud, no build step for users.
- **Definitions are code.** Human-readable YAML in the repo, one file per service/scenario, clean diffs.
- **One process, one port.** Mock traffic, dashboard and API are served together.
- **Scriptable from tests.** Everything the UI does is available over a JSON API.

This is a clean break from Mockey: no XML import, new file format, new URL layout.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22+ | `npx` distribution; built-in `fetch`, `parseArgs`, `node:sqlite` |
| HTTP | Hono + `@hono/node-server` | Small, fast, Web-standard `Request`/`Response`; trivial in-process testing via `app.request()` |
| UI | Server-rendered Hono JSX + htmx | No client build or bundler; types shared with the server; partial updates and polling via attributes. Rich widgets (e.g. a JSON editor) can be added later as isolated islands |
| Validation | Zod 4 | One schema for files, API input and TS types |
| Storage | YAML files (`yaml`) | Git-friendly; block scalars keep bodies readable |
| Tests | Vitest | Fast; tests hit the real Hono app in-process |
| Build | `tsc` → `dist/` | Plain ESM output; no bundler needed |

## Layout

```
src/
  cli.ts            arg parsing, `init`, server start
  init.ts           example definitions
  core/
    schema.ts       Zod schemas + types (Service, Scenario, MatchRule, Profile)
    path.ts         path templates → regex, specificity ranking
    repo.ts         Repo interface; FileRepo (YAML tree), MemoryRepo (tests)
    store.ts        in-memory definitions + profiles, validation, write-through to Repo
    engine.ts       resolve request → scenario/proxy response; delay; record
    history.ts      bounded in-memory request log (event emitter)
  http/
    app.ts          composes the three sub-apps below
    api.ts          /_mimic/api — JSON management API
    ui.tsx          /_mimic — dashboard pages and form handlers
    mock.ts         * — mock traffic (CORS, x-mimic-* headers)
  ui/
    layout.tsx      page shell and styles
    pages.tsx       list/detail pages
    forms.tsx       service, scenario and profile forms
    form-data.ts    form values <-> domain objects, Zod issues -> field errors
test/               vitest suites
```

### Request flow (mock traffic)

1. Answer CORS preflight if present.
2. `Store.resolve(method, path)` → most specific service (literal > `{param}` > `/*`; exact method > `ANY`).
3. `Engine.resolve` by mode:
   - static → `defaultScenario`
   - dynamic → highest-scoring `match`; fallback `defaultScenario` → `errorScenario` → 404
   - proxy → `fetch(upstream + path + query)`; on error `errorScenario` → 502
4. Apply delay (scenario overrides service).
5. Record to history; respond with `x-mimic-*` headers.

## Mockey → Mimic feature map

| Mockey | Mimic | Phase |
|---|---|---|
| Services, scenarios, static/dynamic/proxy modes | Same concepts, YAML on disk | **0 (done)** |
| Hang time | `delayMs` on service/scenario | **0** |
| Dynamic match (substring / JSON rules) | Structured `match` (method, params, query, headers, bodyContains) | **0**; JSONPath/regex in 2 |
| History + inspect | Live history page and API | **0**; persistence in 2 |
| Error scenario / universal error | Per-service `errorScenario` | **0**; global default in 1 |
| REST API (partial) | Full JSON API | **0** |
| `-p`, `-l`, `-t` (transient), `-H` | `--port`, `--dir`, `--read-only`, `--open` (opt-in) | **0** |
| Service/scenario editing in UI | Create/edit/delete forms | **1 (done)** |
| Service plans | **Profiles**: named sets of mode + scenario per service, switchable in one call; `--profile` on start | **1 (done)** |
| Tags + `-F` filter | `--tag` filter, tag filters in UI | 1 |
| History → save as scenario | "Save as scenario" from a recorded proxy response | 1 |
| Redo request (`/doitagain`) | Replay from history | 1 |
| File watching (n/a) | Reload when YAML changes on disk | 1 |
| Corporate proxy settings | Honour `HTTP(S)_PROXY`/`NO_PROXY` for upstream calls | 2 |
| URL twisting | Path rewrite rules on proxy (`stripPrefix` / regex rewrite) | 2 |
| Response JSON schema validation | Optional `responseSchema` check, surfaced in history | 2 |
| Stats / CSV export | History export (JSON/HAR), per-service counts | 2 |
| Java request-inspector plugins | Optional JS/TS matcher/response functions | 3 |
| Templated responses (n/a) | Body templating from request (params, query, body) | 3 |
| HTTPS interception, mobile view, file manager, API doc pages | Dropped unless requested | — |

## Roadmap

- **Phase 0 — foundation (done):** schemas, file store, engine with three modes, history, JSON API, dashboard with mode/default switching, CLI (`start`, `init`), tests.
- **Phase 1 — daily-driver UI:** ~~CRUD forms for services and scenarios~~, ~~profiles~~ (done); remaining: tags, record-to-scenario, replay, file-watch reload, global error scenario.

### UI conventions

Forms are plain HTML `POST`s (they work without JavaScript). On success the handler redirects (303) with a `?flash=` message; on failure it re-renders the form with the submitted values and per-field errors (422). Zod issue paths and `StoreError.field` map errors onto field names. htmx is used only for in-place updates (the mode/default switcher row, history polling).
- **Phase 2 — proxy fidelity:** outbound proxy env vars, path rewrites, faithful header forwarding (`fetch` adds a few defaults such as `sec-fetch-mode`; switch to `undici.request` if that matters), streaming for large bodies, optional history persistence (`node:sqlite`), HAR export, schema validation.
- **Phase 3 — extensibility:** response templating, user JS hooks, OpenAPI import to bootstrap services, publish to npm with CI (lint, test, release).
