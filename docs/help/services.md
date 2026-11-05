# Services and modes

A service is a route plus a rule for answering it.

## Paths

- `/api/users` matches exactly that path (a trailing slash is fine).
- `{name}` captures one path segment: `/api/users/{id}` matches `/api/users/42` with `id` = `42`. Names may contain letters, digits, `_` and `-`.
- Params can sit inside a segment too: `/files/{name}.{ext}`, `/api/v{version}/status`.
- A trailing `/*` matches the prefix and anything below it: `/anything/*` matches `/anything`, `/anything/a/b`.

When several services match, the most specific wins: literal segments beat params, which beat `/*`. If two are equally specific, one with an exact method beats one with `ANY`.

## Methods

`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, or `ANY` (the default). Two services can share a path with different methods, e.g. `GET /api/users/{id}` and `DELETE /api/users/{id}`.

## Modes

- **static**: always send the default scenario. Simplest; good for "this endpoint returns this".
- **dynamic**: look at each scenario's match rule and send the one that fits the request best, so `/users/404` and `/users/42` can get different answers. See [Scenarios and matching](scenarios.md).
- **proxy**: forward the request to the service's **upstream** and send back the real response, recording it in History. Needs an upstream URL. See [Proxying](proxying.md).

The mode in the service form is the **starting mode**, saved to the YAML. The mode switcher on the Services page changes only the **live** mode, which resets when Mimic restarts; see [Live state](live-state.md).

## Seeing what answers

A service's page shows a diagram of everything that can answer its requests: each scenario (with its status, and whether it's the default, the error scenario, or matched by a rule), the real API if it has an upstream, its hook if it has one, and "Mimic error" for requests nothing could answer. Answers that can't be used in the current mode are greyed out, e.g. every scenario except the default in static mode.

Each request to the service travels across the diagram as a dot to whatever answered it, and back in the colour of its status. The counts show how many requests in History each answer has handled.

## Traffic

Each service shows a small bar chart of its requests over the last 10 minutes, one bar per 30 seconds, with the part that got an error response (4xx or 5xx) in red. You'll find it in the Services table, on the service's page, and on the home page's diagram; it updates as requests arrive, and hovering shows the totals. The numbers are counted separately from History, so they stay right when History is cleared or full.

## Default and error scenarios

- The **default scenario** is what static mode sends, and dynamic mode's fallback when no match rule fits.
- The **error scenario** is sent when a proxy call fails, and is dynamic mode's last fallback.

## Delays

**Delay (ms)** on a service slows every response down, which is handy for testing spinners and timeouts. A scenario's own delay overrides it.

## Tags

Tags are labels on services and scenarios, like `checkout` or `mobile`. On the Services page, click a tag to show only services carrying it (a service counts if it or any of its scenarios has the tag).

You can also limit which services answer requests at all: **Only serve "checkout"** on the Services page, or `--tag checkout` at startup. Services outside the filter respond as if they didn't exist, so their requests get a 404 (or the [global error scenario](scenarios.md#the-global-error-scenario)). This is live state: it resets on restart, and **Serve all services** turns it off.
