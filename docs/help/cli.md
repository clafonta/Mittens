# Command line

```
mimic [start] [options]     start the server
mimic init [--dir <path>]   write example definitions
mimic import <spec>         create services from an OpenAPI 3 file or URL
```

Run without installing via `npx @clafonta/mimic …`, or install it (`npm i -g @clafonta/mimic`, or as a dev dependency) to use `mimic` directly.

## Starting the server

| Option | Environment | Does |
|---|---|---|
| `-p`, `--port <n>` | `MIMIC_PORT` | port to listen on (default 4000) |
| `--host <addr>` | `MIMIC_HOST` | interface (default `127.0.0.1`; `0.0.0.0` for other devices) |
| `-d`, `--dir <path>` | `MIMIC_DIR` | definitions folder (default `./mimic`) |
| `--read-only` | | never write to the definitions |
| `--profile <id>` | `MIMIC_PROFILE` | apply a profile on start (live only) |
| `-t`, `--tag <tags>` | `MIMIC_TAGS` | only serve services with one of these tags |
| `--no-watch` | | don't reload when files change |
| `--no-hooks` | | don't run hook files |
| `--persist-history` | `MIMIC_PERSIST_HISTORY=1` | keep history across restarts |
| `--history-file <path>` | `MIMIC_HISTORY_FILE` | where to keep it |
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
npx @clafonta/mimic --port 8080 --open
npx @clafonta/mimic --profile outage --tag checkout
MIMIC_DIR=test/mocks npx @clafonta/mimic --read-only
npx @clafonta/mimic import https://petstore3.swagger.io/api/v3/openapi.json --dry-run
```
