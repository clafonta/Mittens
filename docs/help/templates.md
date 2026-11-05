# Response templates

Tick **Template** on a scenario (or set `template: true` in its YAML) to fill in parts of the body and header values from the request:

```json
{
  "id": {{params.id | json}},
  "name": {{body.name | default "Anonymous" | json}},
  "page": {{query.page | default 1}},
  "requestId": "{{uuid}}",
  "createdAt": "{{now}}"
}
```

A header value can be a template too, e.g. `location: /api/users/{{params.id}}`.

## Values

| Write | Gets |
|---|---|
| `{{params.id}}` | a path param from the route |
| `{{query.page}}` | a query parameter (the first, if repeated) |
| `{{headers.x-tenant}}` | a request header (any case) |
| `{{body}}` | the raw request body |
| `{{body.user.name}}`, `{{body.items[0].sku}}` | a value from a JSON request body |
| `{{method}}`, `{{path}}`, `{{url}}` | the request method, path, and full URL |

## Helpers

| Write | Gets |
|---|---|
| `{{uuid}}` | a random UUID |
| `{{now}}` | the current time, e.g. `2030-01-01T09:30:00.000Z` |
| `{{timestamp}}` | milliseconds since 1970 |
| `{{randomInt 1 100}}` | a whole number from 1 to 100 |

## Filters

Add filters after a `|`; they apply left to right:

| Filter | Does |
|---|---|
| `default "x"` | uses `"x"` when the value is missing or empty |
| `upper`, `lower` | changes case |
| `json` | writes the value as JSON: strings get quotes and escaping, missing values become `null` |

Use `json` whenever you put a value inside a JSON body: `"name": {{body.name | json}}` stays valid JSON even if the name contains quotes.

## Good to know

- Missing values render as nothing, so add `default` where it matters.
- `\{{` writes a literal `{{`.
- Templates are checked when you save, so a typo like `{{user.id}}` is reported in the form, not when a request arrives.
- Scenarios without **Template** ticked are sent exactly as written, even if they contain `{{`.
- To try a template, open its service page and use **Preview with a request** under the scenario.
- Schema validation checks the filled-in response, not the template.
