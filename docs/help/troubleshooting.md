# Troubleshooting

## Why did I get this response?

Every response says what answered it:

| Header | Tells you |
|---|---|
| `x-mittens-service` | which service matched the path |
| `x-mittens-scenario` | which scenario was sent |
| `x-mittens-source` | why: `scenario`, `fallback` (no rule matched; default or error scenario used), `proxy`, `hook`, `unmatched` (no service) or `error` (Mittens's own error) |
| `x-mittens-validation` | `pass` / `fail` against the response schema, if there is one |

History shows the same, plus a note explaining fallbacks and errors. Click the request for details.

## "No service matches"

- Check the method: a `GET` service doesn't answer `POST`. Use `ANY` if it should.
- Check the path, including any prefix your app adds (e.g. `/api`).
- A tag filter may be on: the Services page says "Only serving services tagged …", and the 404 names the service that was filtered out.
- `{id}` matches one segment only; `/users/{id}` doesn't match `/users/7/orders`. Use `/users/*` or add a service for that path.

## The wrong scenario answers

- The service must be in **dynamic** mode for match rules to count; static always sends the default.
- Body rules (`Body contains`, `Body matches`, JSON body) need a request with a body; GET requests have none.
- Regexes aren't anchored: `id ~ 4` also matches `14`. Use `^4$`.
- When several scenarios match, the one with the most criteria wins; see [which scenario wins](scenarios.md#which-scenario-wins).

## My edits don't show up

- Edited a YAML file and nothing changed? Look for a red banner at the top of the dashboard: the file may be invalid, in which case Mittens keeps the last good version.
- Started with `--no-watch`? Restart Mittens to pick up file changes.
- Started with `--read-only`? Dashboard edits aren't saved to disk.

## Changes disappear when I restart

Mode switches, profiles and tag filters are live state, which resets on restart by design. Use **Save as starting state** to keep them; see [Live state](live-state.md).

## Proxy mode fails

The History entry says why. Common causes:

- `ECONNREFUSED` / `ENOTFOUND`: the upstream URL is wrong or unreachable from your machine.
- `407 Proxy Authentication Required`: your company proxy needs credentials (`http://user:pass@proxy:8080`).
- A certificate error: your company proxy re-signs HTTPS; set `NODE_EXTRA_CA_CERTS`. See [Proxying](proxying.md#behind-a-corporate-proxy).
- The wrong path upstream: use **Try a path** on the service page to see the URL Mittens calls.

## Port 4000 is already in use

Another program (or another Mittens) is using it. Start with `--port 4001`, or stop the other one.

## My phone or another computer can't reach Mittens

Mittens only listens on `127.0.0.1` by default. Start it with `--host 0.0.0.0` and use your computer's network address. To open the dashboard from another machine, use the IP address or the machine's own name; see [Sharing Mittens with a team](sharing.md).
