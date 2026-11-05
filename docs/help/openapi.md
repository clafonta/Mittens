# Importing OpenAPI

If you have an OpenAPI 3.0 or 3.1 spec, Mimic can create the services for you:

- **Dashboard**: **Import OpenAPI** on the Services page; upload or paste the spec, **Preview**, then **Import**.
- **Command line**: `npx @clafonta/mimic import openapi.yaml` (or a URL). Add `--dry-run` to see what would be created.

## What you get

- **One service per operation**, named after its `operationId` (`listPets` becomes `list-pets`).
- **One scenario per response**, or per named example. Bodies come from the spec's examples; where there are none, Mimic makes one up from the schema.
- **Response schemas** for [validation](schemas.md), so you see straight away if a scenario or the real API doesn't fit the spec.
- The first 2xx response as each service's **default scenario**.
- The spec's first server as the **upstream** (switch a service to proxy mode to reach the real API) and its path as a **route prefix**, e.g. `https://api.example.com/v1` gives routes starting with `/v1`.

Existing services are never overwritten: an operation whose id or route already exists is skipped and listed.

## Options

| Option | Does |
|---|---|
| Starting mode (`--mode`) | `static` (default), `dynamic` or `proxy` |
| Path prefix (`--prefix`) | use this route prefix instead of the server's path, e.g. `/api` |
| Extra tags (`--tag`) | add a tag to every imported service, handy for filtering |

## Limits

- Swagger 2.0 isn't supported; convert it to OpenAPI 3 first.
- Only references within the same file (`#/components/...`) are followed.
- Recursive schemas are only checked to their first level.
- Large specs make many files: GitHub's full API is about 1,250 services. Consider importing a smaller spec or deleting what you don't need.
