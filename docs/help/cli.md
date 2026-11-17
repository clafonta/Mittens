# Command line

```
mittens [start] [options]     start the server
mittens init [--dir <path>]   write example definitions, plus AGENTS.md for coding agents
                            (--no-examples: only AGENTS.md and CLAUDE.md, e.g. before import)
mittens mcp [--url <url>]     connect an assistant that starts local commands (see AI assistants)
mittens import <spec>         create services from an OpenAPI 3 file or URL
```

Run without installing via `npx @clafonta/mittens …`, or install it (`npm i -g @clafonta/mittens`, or as a dev dependency) to use `mittens` directly.

## Starting the server

| Option | Environment | Does |
|---|---|---|
| `-p`, `--port <n>` | `MITTENS_PORT` | port to listen on (default 4000); if it's taken, Mittens suggests a free one |
| `--host <addr>` | `MITTENS_HOST` | interface (default `127.0.0.1`; `0.0.0.0` for other devices) |
| `-d`, `--dir <path>` | `MITTENS_DIR` | definitions folder (default `./mittens`) |
| `--read-only` | | never write to the definitions |
| `--profile <id>` | `MITTENS_PROFILE` | apply a profile on start (live only) |
| `-t`, `--tag <tags>` | `MITTENS_TAGS` | only serve services with one of these tags |
| `--no-watch` | | don't reload when files change |
| `--no-hooks` | | don't run hook files |
| `--persist-history` | `MITTENS_PERSIST_HISTORY=1` | keep history across restarts |
| `--history-file <path>` | `MITTENS_HISTORY_FILE` | where to keep it |
| `--history-limit <n>` | | requests kept (default 500) |
| `--upstream-proxy <url>` | | send proxy-mode calls through this proxy |
| `--no-upstream-proxy` | | ignore `HTTP_PROXY` / `HTTPS_PROXY` |
| `--open` | | open the dashboard in a browser |
| `-h`, `--help` | | show help |
| `-v`, `--version` | | show the version |

## Importing

| Option | Does |
|---|---|
| `--dir <path>` | definitions folder to add to |
| `--dry-run` | show what would be created, write nothing |
| `--mode <mode>` | starting mode: `static` (default), `dynamic` or `proxy` |
| `--prefix <path>` | route prefix instead of the spec's server path |
| `--tag <tag>` | add a tag to every imported service |

## Examples

```sh
npx @clafonta/mittens --port 8080 --open
npx @clafonta/mittens --profile outage --tag checkout
MITTENS_DIR=test/mocks npx @clafonta/mittens --read-only
npx @clafonta/mittens import https://petstore3.swagger.io/api/v3/openapi.json --dry-run
```
