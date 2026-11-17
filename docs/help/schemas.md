# Response schemas

Give a service a **response schema** and every response it sends, mocked or proxied, is checked against it. This catches mocks that no longer look like the real API, and real APIs that changed without telling you.

## Adding one

In the service form, **Response schema** takes JSON: schemas keyed by status.

```json
{
  "2xx": {
    "type": "object",
    "required": ["id", "email"],
    "properties": { "email": { "type": "string", "format": "email" } }
  },
  "404": { "type": "object", "required": ["error"] },
  "default": { "type": "object" }
}
```

A key is an exact status (`"404"`), a class (`"2xx"`) or `"default"`; the most specific one that exists is used. Statuses with no matching key aren't checked. In YAML, `responseSchema` takes the same structure.

Schemas are standard JSON Schema: 2020-12, or draft-07 when the schema's `$schema` says so. Formats like `email`, `date-time` and `uuid` are checked; unknown keywords (like OpenAPI's `example`) are ignored.

## Where results show up

- **History**: each request shows **schema ✓** or **schema ✗**. Use **schema failures** to list only the failures; open a request to see exactly what's wrong (e.g. `/email: must match format "email"`).
- **Service page**: each scenario is checked too, so you can see at a glance which mocks have drifted.
- **Response header**: `x-mittens-validation: pass` or `fail`, handy in automated tests.

Validation only reports; it never changes the response. Mittens's own error responses aren't checked.

## Checking the real API

Put a service with a schema in proxy mode and use your app: every real response is checked, which quickly shows whether the API still matches its contract.
