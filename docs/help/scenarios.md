# Scenarios and matching

A scenario is one canned response: a status code, headers, a body, and optionally a delay and a match rule.

## Writing a scenario

- **Status**: any code from 100 to 599. Test your error handling with 401, 404, 500, 503.
- **Headers**: one `name: value` per line, e.g. `content-type: application/json`.
- **Body**: sent exactly as written, unless the scenario is a [template](templates.md).
- **Delay**: overrides the service delay for this scenario.

## Match rules

In dynamic mode, Mimic compares the request with each scenario's match rule. Every criterion you fill in must match. Leave a scenario's match rule empty if it should only be used as a default.

| Criterion | Matches when |
|---|---|
| Method | the request method is this one |
| Path params | e.g. `id: 404`, the `{id}` in the route captured `404` |
| Query | e.g. `verbose: true`, `?verbose=true` is in the URL |
| Request headers | e.g. `x-tenant: acme`; header names ignore case |
| Body contains | the raw body contains this text (ignoring case) |
| Body matches | the raw body matches this regular expression |
| JSON body | JSONPath conditions on a JSON body (below) |

Body criteria only work for requests that have a body: GET and HEAD requests never do.

### Regular expressions

In the params, query and headers boxes, `name: value` must be equal, while `name ~ regex` tests a regular expression and `name ~i regex` also ignores case:

```
id ~ ^9\d+$
user-agent ~i iphone|android
```

Regexes aren't anchored: `\d` matches any value containing a digit. Add `^` and `$` to match the whole value.

### JSONPath

The **JSON body** box takes one condition per line. A condition passes if any value the path selects fits:

```
$.user.role = admin
$.quantity = 100
$.items[*].sku ~ ^X-
$.coupon exists
$.legacyField missing
```

`= 100`, `= true` and `= null` compare as JSON numbers, booleans and null; `= "100"` is the string. Filters work too: `$.items[?(@.gift === true)] exists`.

In YAML the same rule looks like this:

```yaml
match:
  params: { id: { regex: "^9\\d+$" } }
  json:
    $.user.role: admin
    $.items[*].sku: { regex: "^X-" }
    $.coupon: { exists: true }
```

## Which scenario wins

1. Scenarios whose match rule fits the request are candidates.
2. The candidate with the **most criteria** wins, so a rule checking `id` and `verbose` beats one checking only `id`.
3. On a tie, the one with **more exact criteria** (not regexes) wins, so `id: 404` beats `id ~ .*`.
4. If nothing fits, Mimic sends the service's default scenario, then its error scenario, then a 404 explaining that nothing matched.

To check which scenario answered, look at the `x-mimic-scenario` response header, or open the request in History.

## Error scenarios

A service's **error scenario** is sent when a proxy call fails (timeout, refused connection, proxy error) and as dynamic mode's last fallback.

## The global error scenario

On the **Settings** page you can choose one scenario, from any service, as the **global error scenario**. Mimic sends it whenever it would otherwise answer with its own error: no service matches the request, a dynamic service has nothing to fall back on, or a proxy call fails and the service has no error scenario. A service's own fallbacks always come first.

Use it with care: if the global error looks like a normal response, real problems (a typo in a URL, a missing service) become hard to notice. History always records why it was used.
