# Importing OpenAPI

If you have an OpenAPI 3.0 or 3.1 spec, Mittens can create the services for you:

- **Dashboard**: **Import OpenAPI** on the Services page; upload or paste the spec, **Preview**, then **Import**.
- **Command line**: `npx @clafonta/mittens import openapi.yaml` (or a URL). Add `--dry-run` to see what would be created.

## What you get

- **One service per operation**, named after its `operationId` (`listPets` becomes `list-pets`).
- **One scenario per response**, or per named example, named after the response's description: its first few words, without "the" or "a" (`409` "Not enough stock for this product" becomes `409-not-enough-stock`). Bodies come from the spec's examples; where there are none, Mittens makes one up from the schema, guessing values from property names (`author` → "Ada Lovelace", `createdAt` → a date) and keeping counts in step with the list beside them. Rewrite these with real-looking data when you refine the scenarios.
- **Response schemas** for [validation](schemas.md), so you see straight away if a scenario or the real API doesn't fit the spec.
- The first 2xx response as each service's **default scenario**.
- The spec's first server as the **upstream** (switch a service to proxy mode to reach the real API) and its path as a **route prefix**, e.g. `https://api.acme.dev/v1` gives routes starting with `/v1`. Servers on placeholder hosts (`example.com`, `*.example`, `*.test`, `*.invalid`) only give the prefix: Mittens doesn't set an upstream that can't exist, and says so.

Existing services are never overwritten: an operation whose id or route already exists is skipped and listed. Run `npx @clafonta/mittens init --no-examples` before or after importing to add `AGENTS.md` for coding agents without the example services.

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
