# Mimic

A local-first HTTP mock server and recording proxy for developers. Point your app at Mimic instead of a real backend, then switch each endpoint between canned responses, request-matched responses, or the real service — and see every request in a live history.

Mimic is a ground-up successor to [Mockey](https://github.com/clafonta/Mockey).

## Quick start

```sh
npx @laboriouslabs/mimic init   # writes example definitions to ./mimic
npx @laboriouslabs/mimic        # http://127.0.0.1:4000, dashboard at /_mimic
```

```sh
curl localhost:4000/api/users/42    # 200, "found" scenario
curl localhost:4000/api/users/404   # 404, matched by path param
curl localhost:4000/anything/hi     # proxied to httpbin.org
```

Requires Node.js 22+. Installed globally (`npm i -g @laboriouslabs/mimic`), the command is just `mimic`.

## Concepts

- **Service** — a route (`path` + `method`) and how to answer it.
- **Scenario** — a canned response: status, headers, body, optional delay and `match` rule.
- **Profile** — a named preset ("happy path", "outage") that sets the mode and/or default scenario of several services in one step. Apply one from the dashboard, the API, or at startup with `--profile`.
- **Live state** — what each service is doing right now. The YAML holds each service's *starting* mode and default scenario; switching modes in the dashboard, applying a profile, or `--profile` changes only the live state, which is kept in memory and resets when Mimic restarts. Your definition files never change behind your back. Use **Save as starting state** (or `POST /_mimic/api/state/save`) to write it back on purpose, or **Reset** to return to the files.
- **Mode** (per service):
  - `static` — always return `defaultScenario`.
  - `dynamic` — return the scenario whose `match` rule best fits the request; otherwise fall back to `defaultScenario`, then `errorScenario`.
  - `proxy` — forward to `upstream` and record the exchange; on failure, return `errorScenario` (or a 502).
- **Tags** — labels on services and scenarios. Click a tag in the dashboard to filter the list, or limit which services answer requests with `--tag checkout` (or **Only serve “checkout”** in the dashboard). Services outside the filter respond as if they didn't exist. A service counts as tagged if it or any of its scenarios carries the tag. The serving filter is live state, like modes.
- **Global error scenario** — one scenario, chosen on the **Settings** page (stored in `mimic.yaml`), returned whenever Mimic would otherwise answer with its own error: no service matches, a dynamic service has no match and no fallback, a proxy fails without an `errorScenario`. Service-level fallbacks always win.

Services, scenarios and profiles can all be created and edited in the dashboard, or by editing the YAML directly. Everything under `/_mimic` is Mimic's own dashboard and API; every other path is mock traffic. Responses carry `x-mimic-service`, `x-mimic-scenario` and `x-mimic-source` headers so you can tell what answered.

## Definitions on disk

Definitions are plain YAML, one file per service and per scenario, so they diff and review cleanly in git:

```
mimic/
  services/
    users/
      service.yaml
      scenarios/
        found.yaml
        not-found.yaml
  profiles/
    outage.yaml
  mimic.yaml              # optional project settings
```

```yaml
# services/users/service.yaml
name: Users API
path: /api/users/{id}     # {param} captures a segment; a trailing /* matches any suffix
method: GET               # or ANY
mode: dynamic             # starting mode: static | dynamic | proxy
defaultScenario: found    # starting default scenario
errorScenario: server-error
upstream: https://api.example.com   # required for proxy mode
delayMs: 0
```

```yaml
# services/users/scenarios/not-found.yaml
name: User not found
status: 404
headers:
  content-type: application/json
body: |
  { "error": "user_not_found" }
match:                    # dynamic mode: every listed criterion must match; most criteria wins
  method: GET
  params: { id: "404" }
  query: { verbose: "true" }
  headers: { x-tenant: acme }
  bodyContains: needle    # case-insensitive substring
delayMs: 250              # overrides the service delay
```

```yaml
# profiles/outage.yaml
name: Outage
description: Every users lookup fails with a 500.
services:                 # services not listed are left alone
  users:
    mode: static          # optional
    scenario: server-error   # optional; becomes the default scenario
```

```yaml
# mimic.yaml
errorScenario:            # global error scenario
  service: users
  scenario: server-error
```

Directory and file names are the IDs (lowercase, digits, dashes). `new` and `apply` are reserved.

Mimic watches the definitions directory: edit a file in your editor and it reloads within a moment, keeping any live state that still applies. If a file is invalid, Mimic keeps serving the last good version and shows the error in the dashboard and the terminal until you fix it. Turn this off with `--no-watch`.

## Recording real responses

Put a service in `proxy` mode, exercise your app, then open a request in **History** and click **Save as scenario**. The form comes prefilled with the status, the response headers worth keeping, the body, and a match rule built from the request's path params and query, so you can review it before saving. Scripts can do the same with `POST /_mimic/api/history/:id/scenario`.

Recorded bodies are kept up to 256 KB; larger responses are marked as truncated and can't be saved as scenarios.

## Replaying requests

Open any request in **History** and click **Replay** to send it again — same method, path, query, headers and body — through whatever the services are doing *now*. Handy after switching a mode or editing a scenario: the new entry says whether the response matches the original and, if not, what changed (status, body, which scenario answered). Scripts can use `POST /_mimic/api/history/:id/replay`.

## CLI

```
mimic [start] [options]
mimic init [--dir <path>]

  -p, --port <n>     default 4000   (MIMIC_PORT)
      --host <addr>  default 127.0.0.1 (MIMIC_HOST)
  -d, --dir <path>   default ./mimic (MIMIC_DIR)
      --read-only    never write changes to disk
      --no-watch     don't reload when definition files change
      --profile <id> apply a profile on start, live only (MIMIC_PROFILE)
  -t, --tag <tags>   only serve services with one of these tags; comma-separated
                     or repeated, live only (MIMIC_TAGS)
      --open         open the dashboard in a browser
```

## HTTP API

All under `/_mimic/api`, JSON in and out:

| Method | Path | |
|---|---|---|
| GET | `/services` | list services (`?tag=a&tag=b` keeps those with any of the tags) |
| GET | `/tags` | every tag in use, and the active serving filter |
| POST | `/services` | create a service |
| GET / PATCH / DELETE | `/services/:id` | read (live view) / edit the definition / delete |
| PUT / DELETE | `/services/:id/scenarios/:sid` | upsert / delete a scenario |
| GET | `/state` | live mode and default per service, with `modified` and `starting` values |
| PATCH | `/state/services/:id` | change live `mode` / `defaultScenario` (`null` clears) |
| DELETE | `/state/services/:id`, `/state` | reset one / all services to their starting state |
| PUT | `/state/tags` | set the serving filter; body `{ "tags": ["checkout"] }`, `[]` serves all |
| POST | `/state/save` | write the live state back to the YAML |
| GET | `/profiles` | list, each with `active` and `problems` |
| POST | `/profiles` | create (`?from=current` fills `services` from the current state) |
| GET / PUT / DELETE | `/profiles/:id` | read / replace / delete |
| POST | `/profiles/:id/apply` | apply to live state, all-or-nothing; returns the changed service IDs |
| GET / DELETE | `/history` | list (`?service=id`) / clear |
| GET | `/history/:id` | one request/response |
| POST | `/history/:id/scenario` | save the recorded response as a scenario; body `{ id?, name?, service?, makeDefault? }` |
| POST | `/history/:id/replay` | send the recorded request again; returns the new entry (with `replayOf`) |
| GET / PUT | `/settings` | read / replace `mimic.yaml` settings, e.g. `{ "errorScenario": { "service": "users", "scenario": "server-error" } }` |
| GET | `/health` | liveness |

Handy in test setup, e.g. `POST /_mimic/api/profiles/outage/apply`, or `PATCH /_mimic/api/state/services/users {"mode":"static","defaultScenario":"server-error"}`, then `DELETE /_mimic/api/state` in teardown. None of these touch your files.

## Development

```sh
npm install
npm run dev        # tsx watch, serves examples/mimic
npm test           # vitest
npm run typecheck
npm run build      # emits dist/
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap.

## License

MIT
