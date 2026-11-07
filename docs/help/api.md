# HTTP API

Everything the dashboard does is available as JSON under `/_mimic/api`, so scripts and automated tests can set Mimic up.

## In tests

A typical pattern: start Mimic once, then in each test put services into the state you need, and reset afterwards.

```sh
# before a test: apply a profile, or set one service
curl -X POST http://localhost:4000/_mimic/api/profiles/outage/apply
curl -X PATCH http://localhost:4000/_mimic/api/state/services/users \
  -H 'content-type: application/json' \
  -d '{"mode":"static","defaultScenario":"server-error"}'

# after it: back to what the files say, and clear history
curl -X DELETE http://localhost:4000/_mimic/api/state
curl -X DELETE http://localhost:4000/_mimic/api/history
```

None of these touch your files. To assert on what your app sent, read `GET /_mimic/api/history?service=users`. To assert on contracts, check the `x-mimic-validation` header or `GET /_mimic/api/history?validation=fail`.

## Endpoints

All paths below start with `/_mimic/api`.

### Services and scenarios

| Method | Path | Does |
|---|---|---|
| GET | `/services` | list services (`?tag=a&tag=b` keeps those with any of the tags) |
| POST | `/services` | create a service |
| GET / PATCH / DELETE | `/services/:id` | read (live view) / edit the definition / delete |
| GET | `/services/:id/upstream?path=` | the URL proxy mode would call for a path |
| PUT / DELETE | `/services/:id/scenarios/:sid` | create or replace / delete a scenario |
| POST | `/services/:id/scenarios/:sid/render` | render a scenario for a sample request: `{ method?, path?, headers?, body? }` |
| GET | `/tags` | all tags, and the serving filter |
| POST | `/import/openapi` | import a spec (request body: the spec); `?dryRun=1`, `mode`, `prefix`, `tags` |

### Live state and profiles

| Method | Path | Does |
|---|---|---|
| GET | `/state` | each service's live mode and default, with its starting values |
| PATCH | `/state/services/:id` | change live `mode` / `defaultScenario` (`null` clears) / `delayMs` |
| DELETE | `/state/services/:id`, `/state` | reset one / every service to its starting state |
| PUT | `/state/tags` | set the serving filter: `{ "tags": ["checkout"] }`; `[]` serves all |
| POST | `/state/save` | write the live state into the files |
| GET | `/profiles` | list, each with `active` and `problems` |
| POST | `/profiles` | create (`?from=current` fills in the current state) |
| GET / PUT / DELETE | `/profiles/:id` | read / replace / delete |
| POST | `/profiles/:id/apply` | apply; returns the services that changed |

### History

| Method | Path | Does |
|---|---|---|
| GET / DELETE | `/history` | list (`?service=id`, `?validation=pass` or `fail`) / clear |
| GET | `/history/export` | download as `?format=har` (default) or `json`; same filters |
| GET | `/history/:id` | one request and response |
| POST | `/history/:id/scenario` | save the response as a scenario: `{ id?, name?, service?, makeDefault? }` |
| POST | `/history/:id/replay` | send the request again; returns the new entry |

### Hooks, settings, health

| Method | Path | Does |
|---|---|---|
| GET | `/hooks` | loaded hooks and load errors |
| DELETE | `/hooks/state` | clear hook state: every service's `ctx.state` and `ctx.shared` (`?service=id` for one service) |
| GET / PUT | `/settings` | read / replace settings, e.g. `{ "errorScenario": { "service": "users", "scenario": "server-error" } }` |
| GET | `/health` | `{ "ok": true }` while Mimic is running |
| GET | `/events` | a live stream ([server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)): a `request` event for every request Mimic handles, `clear` when history is cleared |

## Watching requests live

`/events` sends a short summary of each request as it happens, the same stream the home page's diagram uses:

```sh
curl -N http://localhost:4000/_mimic/api/events
```

```
event: request
data: {"id":"…","method":"GET","path":"/api/users/42","status":200,"source":"scenario","serviceId":"users","scenarioId":"found","durationMs":1,"valid":true}
```

Fields: `method`, `path`, `status`, `source` (as in the `x-mimic-source` header), `serviceId` and `scenarioId` when something answered, `durationMs`, and `valid` when a response schema was checked. Fetch `/history/:id` for the full request and response.

Errors come back as JSON with an `error` message; validation errors (400) also list `issues`.

## Calling from a browser

Pages served from `localhost` (on any port), such as a dev panel inside the app you're building, can call these endpoints directly: Mimic answers their cross-origin (CORS) requests. Pages from anywhere else can't read them.

Everything under `/_mimic` is meant for your own computer, so Mimic refuses:

- requests that change something (POST, PUT, PATCH, DELETE) from other websites, which a browser would otherwise send on a page's behalf;
- requests addressed to a host name other than `localhost`, an IP address, or this computer's name, which blocks DNS-rebinding tricks.

Scripts and tools that don't run in a browser (curl, tests, CI) aren't affected. Mock traffic isn't either: your mocks answer any origin.
