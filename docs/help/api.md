# HTTP API

Everything the dashboard does is available as JSON under `/_mittens/api`, so scripts and automated tests can set Mittens up.

## In tests

A typical pattern: start Mittens once, then in each test put services into the state you need, and reset afterwards.

```sh
# before a test: apply a profile, or set one service
curl -X POST http://localhost:4000/_mittens/api/profiles/outage/apply
curl -X PATCH http://localhost:4000/_mittens/api/state/services/users \
  -H 'content-type: application/json' \
  -d '{"mode":"static","defaultScenario":"server-error"}'

# between tests: a clean slate in one call
curl -X POST http://localhost:4000/_mittens/api/reset
```

`POST /reset` puts every service back to what its files say (mode, default scenario, delay), clears the tag filter, empties hook state (`ctx.state` and `ctx.shared`) and clears history. To leave parts alone, name them in `keep`: `{"keep": ["history"]}`, or `?keep=history,hooks`. The parts are `state`, `tags`, `hooks` and `history`. It replies with what it did:

```json
{ "reset": ["state", "tags", "hooks", "history"], "services": ["payments"], "tags": [], "history": 12 }
```

None of these touch your files. To assert on what your app sent, read `GET /_mittens/api/history?service=users`. To assert on contracts, check the `x-mittens-validation` header or `GET /_mittens/api/history?validation=fail`.

## Endpoints

All paths below start with `/_mittens/api`.

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
| POST | `/reset` | clean slate: live state, tag filter, hook state and history; `{ "keep": ["history"] }` leaves parts alone |
| GET | `/profiles` | list, each with `active` and `problems` |
| POST | `/profiles` | create (`?from=current` fills in the current state) |
| GET / PUT / DELETE | `/profiles/:id` | read / replace / delete |
| PATCH | `/profiles/:id` | change only what you send: `{ "services": { "reviews": { "scenario": "down" }, "cart": null } }` (`null` removes a service); `name`, `description` |
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
| GET | `/health` | `{ "ok": true }` while Mittens is running |
| GET | `/events` | a live stream ([server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)): `request` for every request Mittens handles, `clear` when history is cleared, `state` when the live state changes, `hooks` when hook state is cleared, `definitions` when services, scenarios, profiles or settings change |

## Watching requests live

`/events` sends a short summary of each request as it happens, the same stream the home page's diagram uses:

```sh
curl -N http://localhost:4000/_mittens/api/events
```

```
event: request
data: {"id":"…","method":"GET","path":"/api/users/42","status":200,"source":"scenario","serviceId":"users","scenarioId":"found","durationMs":1,"valid":true}
```

Fields: `method`, `path`, `status`, `source` (as in the `x-mittens-source` header), `serviceId` and `scenarioId` when something answered, `durationMs`, and `valid` when a response schema was checked. Fetch `/history/:id` for the full request and response.

The same stream sends `state` (`{"modified": ["users"], "tags": []}`) whenever a mode, default scenario or delay changes, a profile is applied or the tag filter changes, `hooks` (`{"service": "cart"}`, or `{"service": null}` for every service) when hook state is cleared, from the dashboard, `DELETE /hooks/state` or `POST /reset`, and `definitions` when anything in the definitions folder changes (from the dashboard, the API, or a file edit). A dev panel in your app can listen for them to refresh only when something actually changed:

```js
const events = new EventSource("http://localhost:4000/_mittens/api/events");
events.addEventListener("state", () => refetchEverything());
events.addEventListener("hooks", () => refetchEverything()); // e.g. a cart kept by a hook was emptied
```

`POST /reset` sends `hooks` every time (unless you keep hooks), `clear` unless you keep history, and `state` when the live state or tag filter actually changed.

Errors come back as JSON with an `error` message; validation errors (400) also list `issues`.

## Calling from a browser

Pages served from `localhost` (on any port), such as a dev panel inside the app you're building, can call these endpoints directly: Mittens answers their cross-origin (CORS) requests. Pages from anywhere else can't read them.

Everything under `/_mittens` is meant for your own computer, so Mittens refuses:

- requests that change something (POST, PUT, PATCH, DELETE) from other websites, which a browser would otherwise send on a page's behalf;
- requests addressed to a host name other than `localhost`, an IP address, or this computer's name, which blocks DNS-rebinding tricks.

Scripts and tools that don't run in a browser (curl, tests, CI) aren't affected. Mock traffic isn't either: your mocks answer any origin.
