import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * AGENTS.md for the definitions folder: how a coding agent (Codex, Copilot,
 * Cursor, Claude Code…) should read and edit Mimic's YAML. The YAML examples
 * here are checked against the real schemas by the tests, so keep them valid.
 */
export const AGENTS_MD = `# Mimic definitions: notes for coding agents

This folder holds the definitions for [Mimic](https://www.npmjs.com/package/@clafonta/mimic), a local HTTP mock server. The app under development calls Mimic (by default \`http://localhost:4000\`) instead of a real backend, and Mimic answers from these files.

## Prefer Mimic's tools when you have them

If Mimic is connected to you as an MCP server (tools like \`get_overview\`, \`upsert_scenario\`, \`send_request\`), use those tools rather than editing files: they validate input, apply changes immediately, and can switch a service's behaviour temporarily without touching these files. Otherwise, edit the YAML as described below. Mimic reloads it within a moment of saving.

## Layout

\`\`\`
services/<service-id>/service.yaml           one service: a route and how to answer it
services/<service-id>/scenarios/<id>.yaml    one canned response per file
services/<service-id>/hook.ts                optional code hook (also .js, .mjs, .mts)
profiles/<profile-id>.yaml                   named sets of modes/scenarios, e.g. "outage"
mimic.yaml                                   optional settings
.mimic/                                      saved request history; don't edit or commit
\`\`\`

- Folder and file names are the ids: lowercase letters, digits and dashes (\`^[a-z0-9][a-z0-9-]*$\`). \`new\` and \`apply\` are reserved.
- Unknown fields are rejected: one typo makes Mimic keep serving the previous version of every file until it's fixed.

## Service (\`services/users/service.yaml\`)

\`\`\`yaml
name: Users API
description: Look up users.
path: /api/users/{id}        # {param} captures one segment; a trailing /* matches any suffix
method: GET                  # GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, or ANY (default)
mode: dynamic                # static | dynamic | proxy (the starting mode)
defaultScenario: found       # static mode sends it; dynamic mode falls back to it
errorScenario: server-error  # sent when proxying fails; dynamic mode's last fallback
upstream: https://api.example.com   # needed for proxy mode
delayMs: 0
tags: [users]
\`\`\`

Modes: \`static\` always sends \`defaultScenario\`; \`dynamic\` sends the scenario whose \`match\` rule fits the request best (most criteria wins; exact beats regex on ties), else the default, else the error scenario; \`proxy\` forwards to \`upstream\` and records the real response.

Optional: \`stripPrefix\` and \`rewrite\` (\`[{from: regex, to: replacement}]\`) change the path sent upstream; \`responseSchema\` maps a status (\`"200"\`), class (\`2xx\`) or \`default\` to a JSON Schema that every response is checked against.

## Scenario (\`services/users/scenarios/not-found.yaml\`)

\`\`\`yaml
name: User not found
status: 404
headers:
  content-type: application/json
body: |
  { "error": "user_not_found" }
match:                       # used in dynamic mode; every listed criterion must fit
  params: { id: "404" }
\`\`\`

Match criteria: \`method\`, \`params\`, \`query\`, \`headers\` (values are exact strings, or \`{ regex: "^9\\\\d+$", flags: i }\`), \`bodyContains\` (case-insensitive text), \`bodyMatches\` (\`{ regex }\`), and \`json\` (JSONPath conditions on a JSON body):

\`\`\`yaml
name: VIP order
status: 201
body: '{"tier": "vip"}'
match:
  method: POST
  json:
    $.customer.tier: gold
    $.items[*].sku: { regex: "^X-" }
    $.coupon: { exists: true }
\`\`\`

A scenario with \`template: true\` fills in \`{{ }}\` from the request, in the body and header values:

\`\`\`yaml
name: Created
status: 201
template: true
headers:
  content-type: application/json
  location: /api/users/{{params.id}}
body: |
  { "id": {{params.id | json}}, "name": {{body.name | default "Anonymous" | json}}, "at": "{{now}}" }
\`\`\`

Values: \`params.x\`, \`query.x\`, \`headers.x\`, \`body\`, \`body.a.b[0]\`, \`method\`, \`path\`, \`url\`. Helpers: \`uuid\`, \`now\`, \`timestamp\`, \`randomInt 1 100\`. Filters: \`default "x"\`, \`upper\`, \`lower\`, \`json\` (use it for values inside JSON).

## Profile (\`profiles/outage.yaml\`) and settings (\`mimic.yaml\`)

\`\`\`yaml
name: Outage
description: Users lookups fail.
services:
  users: { mode: static, scenario: server-error }
\`\`\`

\`\`\`yaml
errorScenario: { service: users, scenario: server-error }   # used when nothing else can answer
\`\`\`

## After editing, check your work

1. \`curl -s http://localhost:4000/_mimic/api/health\`: if \`reloadError\` is set, a file is invalid (the message names it) and Mimic is still serving the previous version.
2. Call the route as the app would, e.g. \`curl -i http://localhost:4000/api/users/404\`. The \`x-mimic-service\`, \`x-mimic-scenario\` and \`x-mimic-source\` response headers say what answered.
3. \`curl -s "http://localhost:4000/_mimic/api/history?service=users"\` lists recent requests and how each was answered.

## Good to know

- To change behaviour temporarily (make a service fail while testing), don't edit these files: \`curl -X PATCH http://localhost:4000/_mimic/api/state/services/users -H 'content-type: application/json' -d '{"mode":"static","defaultScenario":"server-error"}'\`, and \`curl -X DELETE http://localhost:4000/_mimic/api/state\` to undo. That live state resets when Mimic restarts.
- Hooks (\`hook.ts\`) export \`request(req, ctx)\` and/or \`response(req, res, ctx)\`; see the help below.
- Full documentation: http://localhost:4000/_mimic/help, or \`read_help\` if you have Mimic's tools.
`;

/** Claude Code reads CLAUDE.md rather than AGENTS.md; this imports it. */
export const CLAUDE_MD = `@AGENTS.md
`;

export type Written = "created" | "exists";

/** Writes AGENTS.md and CLAUDE.md into the definitions folder, leaving existing files alone. */
export async function writeAgentFiles(root: string): Promise<{ agents: Written; claude: Written }> {
  await mkdir(root, { recursive: true });
  const write = async (name: string, content: string): Promise<Written> => {
    const file = path.join(root, name);
    if (existsSync(file)) return "exists";
    await writeFile(file, content);
    return "created";
  };
  return { agents: await write("AGENTS.md", AGENTS_MD), claude: await write("CLAUDE.md", CLAUDE_MD) };
}
