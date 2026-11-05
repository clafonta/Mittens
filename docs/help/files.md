# Files on disk

## The definitions folder

Everything you define is plain YAML in the definitions folder (`./mimic`, or `--dir <path>`), one file per service and per scenario, so changes are easy to review in git:

```
mimic/
  services/
    users/
      service.yaml          the service
      hook.ts               optional hook
      scenarios/
        found.yaml          one file per scenario
        not-found.yaml
  profiles/
    outage.yaml
  mimic.yaml                optional settings (global error scenario)
  .mimic/                   history, if --persist-history (git-ignored)
```

Folder and file names are the ids: lowercase letters, digits and dashes. `new` and `apply` are reserved.

## Reloading

Mimic watches the folder. Save a file in your editor and Mimic picks it up within a moment, keeping any live state that still makes sense. If a file is invalid, Mimic keeps serving the last good version and shows the error at the top of every dashboard page (and in the terminal) until you fix it. `--no-watch` turns watching off.

Changes made in the dashboard are written straight to these files.

## Service

```yaml
# services/users/service.yaml
name: Users API
description: Look up a user by id.
path: /api/users/{id}
method: GET                 # or POST, PUT, PATCH, DELETE, HEAD, OPTIONS, ANY (default)
mode: dynamic               # starting mode: static | dynamic | proxy
defaultScenario: found      # starting default scenario
errorScenario: server-error
upstream: https://api.example.com   # needed for proxy mode
stripPrefix: /mock          # proxy mode: see Proxying
rewrite:
  - from: ^/users/(\d+)$
    to: /people/$1
delayMs: 0
tags: [users]
responseSchema:             # see Response schemas
  2xx: { type: object, required: [id] }
```

## Scenario

```yaml
# services/users/scenarios/not-found.yaml
name: User not found
status: 404
headers:
  content-type: application/json
body: |
  { "error": "user_not_found" }
template: false             # true: fill in {{ }} from the request
delayMs: 250                # overrides the service delay
match:                      # dynamic mode; see Scenarios and matching
  params: { id: "404" }
tags: [errors]
```

## Profile and settings

```yaml
# profiles/outage.yaml
name: Outage
services:
  users: { mode: static, scenario: server-error }
```

```yaml
# mimic.yaml
errorScenario:
  service: users
  scenario: server-error
```

## Working with git

- Commit the definitions folder; teammates get the same mocks.
- Switching modes and applying profiles in the dashboard doesn't touch the files (see [Live state](live-state.md)), so day-to-day use keeps your working tree clean.
- `.mimic/` (saved history) is git-ignored automatically because it may contain credentials.
- `--read-only` loads definitions without ever writing to them.
