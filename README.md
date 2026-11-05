# Mimic

A local-first HTTP mock server and recording proxy for developers. Point your app at Mimic instead of a real backend, then switch each endpoint between canned responses, request-matched responses, or the real service — and see every request in a live history.

Mimic is a ground-up successor to [Mockey](https://github.com/clafonta/Mockey).

- **Mock, match or proxy, per endpoint**, switchable live from the dashboard or the API; profiles flip many at once ("happy path", "outage").
- **Definitions are YAML files** you commit next to your code, reloaded as you edit them.
- **Record real traffic** in proxy mode and save responses as scenarios; replay any request; export history as HAR.
- **Request matching** on method, path params, query, headers and body, including regexes and JSONPath.
- **Response templates** (`{{params.id}}`, `{{body.name | json}}`) and **JavaScript/TypeScript hooks** for stateful or unusual cases.
- **OpenAPI import** builds services, example responses and schemas in one command; every response can be **checked against a JSON Schema**.
- **Works on a locked-down laptop:** one `npx` command, no database or Docker, honours corporate `HTTP(S)_PROXY` settings.

## Quick start

```sh
npx @clafonta/mimic init   # writes example definitions to ./mimic
npx @clafonta/mimic        # http://127.0.0.1:4000, dashboard at /_mimic
```

```sh
curl localhost:4000/api/users/42    # 200, "found" scenario
curl localhost:4000/api/users/404   # 404, matched by path param
curl localhost:4000/anything/hi     # proxied to httpbin.org
```

Requires Node.js 22.19+. Installed globally (`npm i -g @clafonta/mimic`), the command is just `mimic`.

## Documentation

Mimic's help is built in: open **Help** in the dashboard ([/_mimic/help](http://localhost:4000/_mimic/help)), or follow the **?** next to any setting. The same pages are in [`docs/help`](docs/help/README.md):

- [Getting started](docs/help/getting-started.md): run Mimic, point your app at it, make your first service
- [Services and modes](docs/help/services.md): routes, methods, static / dynamic / proxy, delays, tags
- [Scenarios and matching](docs/help/scenarios.md): match rules, regexes, JSONPath, which scenario wins, error fallbacks
- [Live state and profiles](docs/help/live-state.md): what changes the files and what doesn't; switching many services at once
- [Recording, history and replay](docs/help/recording.md): capture real traffic, save it as scenarios, replay, export HAR
- [Proxying to real services](docs/help/proxying.md): upstreams, path rewrites, corporate proxies
- [Response templates](docs/help/templates.md): fill responses in from the request
- [Hooks](docs/help/hooks.md): JavaScript or TypeScript for stateful and unusual cases
- [Response schemas](docs/help/schemas.md): check every response against a JSON Schema
- [Importing OpenAPI](docs/help/openapi.md): build services from a spec
- [Files on disk](docs/help/files.md): the definitions folder, YAML reference, reloading, git tips
- [Command line](docs/help/cli.md): commands, options and environment variables
- [HTTP API](docs/help/api.md): control Mimic from scripts and tests
- [Troubleshooting](docs/help/troubleshooting.md): "why did I get this response?" and other puzzles

## Development

```sh
npm install
npm run dev        # tsx watch, serves examples/mimic
npm test           # vitest
npm run typecheck
npm run build      # emits dist/
npm run smoke      # after build: packs, installs the tarball in a scratch project, runs the CLI
```

`npm publish` runs typecheck, tests, build and the smoke test first (`prepublishOnly`); see [docs/RELEASING.md](docs/RELEASING.md). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap.

User documentation lives in `docs/help/*.md` and is what the dashboard's Help shows, so edit it there. Topic order comes from the links in `docs/help/README.md`; link between topics with plain `other.md#section` links, and write examples against `http://localhost:4000` (the dashboard substitutes the real address). `npm test` checks every link, including the **?** links in the UI.

## License

MIT — see [LICENSE](LICENSE).
