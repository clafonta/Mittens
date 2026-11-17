# AI assistants

Instead of working through forms, you can ask the AI assistant you already use to set Mittens up: "make the users API fail with a 500", "mock POST /api/orders with a 422 when quantity is 0", "why did my app get a 404 on /api/users/7?". Mittens speaks the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), which Claude Code, Claude Desktop, Codex, GitHub Copilot in VS Code, Cursor and many other assistants support. Mittens doesn't need an API key: your assistant uses its own.

This is optional: everything an assistant can do, you can also do in the dashboard by hand, and nothing changes unless you connect one. Mittens holds no API keys and never contacts an AI service itself. By default it only listens on your own computer, so only assistants running there can connect (see [Sharing Mittens with a team](sharing.md) to let others connect).

The **Assistants** page in the dashboard has copy-paste setup for each assistant, shows which one is connected, and lists every tool call it makes.

## Connect Claude Code

With Mittens running, in your project folder:

```sh
claude mcp add --transport http mittens http://localhost:4000/_mittens/mcp
```

Then start `claude` and type `/mcp`: **mittens** should be listed as connected. Add `--scope project` to the command to write the setting to `.mcp.json`, so everyone on the project gets it.

## Connect other assistants

- **Assistants that support MCP over HTTP** (VS Code with GitHub Copilot, Cursor and others): use the endpoint `http://localhost:4000/_mittens/mcp`. The Assistants page shows the exact config file for each.
- **Assistants that start local commands** (Claude Desktop, Codex CLI and others): have them run `npx -y @clafonta/mittens mcp`. That command relays to the Mittens that's already running (use `--url` if it's not on port 4000), so changes apply to the mocks your app is using.
- **ChatGPT** runs its connectors in OpenAI's cloud, which can't reach a Mittens on your machine without a tunnel.

## Coding agents that edit files

Agents that work in your repository (Codex, GitHub Copilot's coding agent, Cursor, Claude Code) can also edit the YAML in your definitions folder directly. `mittens init` writes an `AGENTS.md` there describing the file formats, match rules and templates, and how to check an edit worked; and a one-line `CLAUDE.md` that points Claude Code at it. Run `npx @clafonta/mittens init` in an existing project to add them; it doesn't touch your services, and never overwrites the two files once they exist, so edit them as you like.

When an assistant has Mittens's tools (above), it should use those instead, since they validate changes and can switch behaviour without touching your files.

## What your assistant can do

| Area | Tools |
|---|---|
| Look around | `get_overview`, `get_service`, `read_help` |
| Build mocks | `create_service`, `update_service`, `upsert_scenario`, `import_openapi`, `save_request_as_scenario` |
| Try things out | `set_live_state`, `reset_live_state`, `reset_everything`, `apply_profile`, `send_request`, `replay_request` |
| Debug | `list_requests`, `get_request`, `explain_request` |
| Keep changes | `save_live_state`, `save_profile` (with `merge: true` to change only some services) |
| Remove | `delete_service`, `delete_scenario` |

Assistants are told to experiment with the live state (switching modes, applying profiles), which resets when Mittens restarts, and to only change your definition files when you ask them to build or keep something. Deleting tools are marked as destructive, so assistants ask before using them. `send_request` lets your assistant check its own work: the request goes through Mittens like your app's would, and appears in History.

The tools don't write [hooks](hooks.md), since a hook is code you should see and review. For behaviour that needs memory (a cart, records created by POST), your assistant will write `services/<id>/hook.ts` as a file if it can edit files, or suggest it to you. `get_overview` shows which services have a hook, so an assistant knows when code, not a scenario, is answering.

## Things to try

- What's mocked in Mittens right now?
- Make the users API fail with a 500 for every request, then put it back.
- Add POST /api/orders: 201 with an order id from the request, and 422 when quantity is 0. Then test both.
- My app got a 404 for /api/users/7. Why?
- Import ./openapi.yaml into Mittens. Show me what you'd create first.
- Turn the real responses I just recorded into scenarios.

## Safety

You stay in control: assistants such as Claude Code ask before using each tool, experiments change only the live state (which resets when Mittens restarts), and the Assistants page lists every call an assistant makes.

Keep in mind that what your assistant reads from Mittens (your definitions, and recorded requests including any headers or bodies from proxied traffic) is sent to the AI service the assistant uses, just as with any other tool it has. If History holds credentials or personal data, clear it before asking your assistant about it, or don't connect one.

By default Mittens listens only on `127.0.0.1`, so only assistants on your own computer can reach the MCP endpoint. If you start it with `--host 0.0.0.0` to share it, anyone who can reach that machine can connect an assistant too, using its IP address or its machine name (other host names are refused), and there's no login, so only do this on a network you trust. Requests from web pages (another origin) are always refused, as are requests addressed to any other host name, which stops a malicious site from reaching Mittens through DNS tricks. In `--read-only` mode, your assistant's changes stay in memory like any other. As with any tool you give an assistant, review what it proposes before letting it delete things.
