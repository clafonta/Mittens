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

Requires Node.js 22.19+. Installed globally (`npm i -g @laboriouslabs/mimic`), the command is just `mimic`.

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
upstream: https://api.example.com   # required for proxy mode; may include a base path
stripPrefix: /mock        # proxy mode: removed from the path before calling upstream
rewrite:                  # proxy mode: regex replaces on the path, in order, after stripPrefix
  - from: ^/users/(\d+)$
    to: /people/$1
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

## Behind a corporate proxy

Proxy-mode calls honour the usual `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` variables (lowercase forms too), so if your shell is set up for the company proxy, Mimic is as well. Credentials in the URL (`http://user:pass@proxy.corp:8080`) are sent to the proxy and masked in the startup output. Use `--upstream-proxy <url>` to pick a proxy explicitly (NO_PROXY still applies) or `--no-upstream-proxy` to ignore the variables. Requests *to* Mimic are unaffected; this only concerns the calls Mimic makes upstream.

If the proxy re-signs TLS with a company certificate, point Node at it: `NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem npx @laboriouslabs/mimic`. When an upstream call fails, the History entry says why (e.g. `Proxy Authentication Required (407)`, `ECONNREFUSED`).

To see where a request would go after `stripPrefix` and `rewrite`, use **Try a path** on the service page, or `GET /_mimic/api/services/:id/upstream?path=/mock/users/7`.

## Checking responses against a schema

Give a service a `responseSchema` and every response it sends — mocked, proxied, or a fallback — is checked against it. Keys are a status (`"404"`), a class (`2xx`) or `default`; the most specific wins, and statuses without a schema aren't checked.

```yaml
# services/users/service.yaml
responseSchema:
  2xx:
    type: object
    required: [id, email]
    properties:
      email: { type: string, format: email }
  default:
    type: object
    required: [error]
```

Results show up as **schema ✓ / ✗** in History (filter with **schema failures**, or `GET /_mimic/api/history?validation=fail`), with the reasons on the request page, and in an `x-mimic-validation: pass|fail` response header for tests. The service page also checks each scenario, so mocks that have drifted from the real API stand out. Proxying the real API with a schema in place is a quick way to find out whether the contract still holds. Validation reports; it never changes the response.

Schemas are standard JSON Schema: 2020-12 by default, draft-07 when `$schema` says so. Unknown keywords (e.g. OpenAPI's `example`) are ignored, and formats like `email` and `date-time` are checked.

## Exporting history

**Export HAR** / **Export JSON** on the History page (or a service page, for just that service) downloads what's in history. HAR 1.2 opens in browser devtools, Charles, Fiddler and similar tools; Mimic's details (which service and scenario answered, validation results) are kept in `_mimic` fields. Scripts: `GET /_mimic/api/history/export?format=har|json&service=id&validation=fail`.

History is in memory, holds the latest 500 requests, and keeps bodies up to 256 KB.

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
      --upstream-proxy <url>  send proxy-mode calls through this proxy
      --no-upstream-proxy     ignore HTTP(S)_PROXY for proxy-mode calls
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
| GET | `/services/:id/upstream?path=` | the upstream URL proxy mode would call for a path, after rewrites |
| GET | `/state` | live mode and default per service, with `modified` and `starting` values |
| PATCH | `/state/services/:id` | change live `mode` / `defaultScenario` (`null` clears) |
| DELETE | `/state/services/:id`, `/state` | reset one / all services to their starting state |
| PUT | `/state/tags` | set the serving filter; body `{ "tags": ["checkout"] }`, `[]` serves all |
| POST | `/state/save` | write the live state back to the YAML |
| GET | `/profiles` | list, each with `active` and `problems` |
| POST | `/profiles` | create (`?from=current` fills `services` from the current state) |
| GET / PUT / DELETE | `/profiles/:id` | read / replace / delete |
| POST | `/profiles/:id/apply` | apply to live state, all-or-nothing; returns the changed service IDs |
| GET / DELETE | `/history` | list (`?service=id`, `?validation=pass\|fail`) / clear |
| GET | `/history/export` | download as `?format=har` (default) or `json`; same filters |
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
