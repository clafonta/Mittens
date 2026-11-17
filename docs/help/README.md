# Mittens help

Mittens is a mock server and recording proxy that runs on your machine. Point your app at Mittens instead of a real backend, then decide, endpoint by endpoint, whether it gets a canned response, a response picked to fit the request, or the real service, and watch every request arrive in History.

## How it fits together

- A **service** is a route, like `GET /api/users/{id}`, and a **mode** that says how to answer it.
- A **scenario** is one canned response for a service: a status, headers, a body.
- In **static** mode a service always sends its default scenario. In **dynamic** mode it picks the scenario whose match rule fits the request. In **proxy** mode it calls the real API and records what came back.
- **Profiles** switch many services at once ("happy path", "outage").
- Everything is stored as YAML files you can commit next to your code; switching modes in the dashboard doesn't change those files unless you ask it to.

## Topics

In Mittens, the search box above the topic list finds any section; press `/` to jump to it.

1. [Getting started](getting-started.md): run Mittens, point your app at it, make your first service
2. [AI assistants](assistants.md): let Claude, Codex, Copilot or Cursor set Mittens up for you
3. [Services and modes](services.md): routes, methods, static / dynamic / proxy, delays, tags
4. [Scenarios and matching](scenarios.md): match rules, regexes, JSONPath, which scenario wins, error fallbacks
5. [Live state and profiles](live-state.md): what changes the files and what doesn't; switching many services at once
6. [Recording, history and replay](recording.md): capture real traffic, save it as scenarios, replay, export HAR
7. [Proxying to real services](proxying.md): upstreams, path rewrites, corporate proxies
8. [Response templates](templates.md): fill responses in from the request
9. [Hooks](hooks.md): JavaScript or TypeScript for stateful and unusual cases
10. [Response schemas](schemas.md): check every response against a JSON Schema
11. [Importing OpenAPI](openapi.md): build services from a spec
12. [Files on disk](files.md): the definitions folder, YAML reference, reloading, git tips
13. [Sharing Mittens with a team](sharing.md): run it on a shared server; what everyone shares; security
14. [Command line](cli.md): commands, options and environment variables
15. [HTTP API](api.md): control Mittens from scripts and tests
16. [Troubleshooting](troubleshooting.md): "why did I get this response?" and other puzzles
