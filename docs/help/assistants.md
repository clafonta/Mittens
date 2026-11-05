# AI assistants

Instead of working through forms, you can ask the AI assistant you already use to set Mimic up: "make the users API fail with a 500", "mock POST /api/orders with a 422 when quantity is 0", "why did my app get a 404 on /api/users/7?". Mimic speaks the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), which Claude Code, Claude Desktop, Codex, GitHub Copilot in VS Code, Cursor and many other assistants support. Mimic doesn't need an API key: your assistant uses its own.

The **Assistants** page in the dashboard has copy-paste setup for each assistant, shows which one is connected, and lists every tool call it makes.

## Connect Claude Code

With Mimic running, in your project folder:

```sh
claude mcp add --transport http mimic http://localhost:4000/_mimic/mcp
```

Then start `claude` and type `/mcp`: **mimic** should be listed as connected. Add `--scope project` to the command to write the setting to `.mcp.json`, so everyone on the project gets it.

## Connect other assistants

- **Assistants that support MCP over HTTP** (VS Code with GitHub Copilot, Cursor and others): use the endpoint `http://localhost:4000/_mimic/mcp`. The Assistants page shows the exact config file for each.
- **Assistants that start local commands** (Claude Desktop, Codex CLI and others): have them run `npx -y @clafonta/mimic mcp`. That command relays to the Mimic that's already running (use `--url` if it's not on port 4000), so changes apply to the mocks your app is using.
- **ChatGPT** runs its connectors in OpenAI's cloud, which can't reach a Mimic on your machine without a tunnel.

## What your assistant can do

| Area | Tools |
|---|---|
| Look around | `get_overview`, `get_service`, `read_help` |
| Build mocks | `create_service`, `update_service`, `upsert_scenario`, `import_openapi`, `save_request_as_scenario` |
| Try things out | `set_live_state`, `reset_live_state`, `apply_profile`, `send_request`, `replay_request` |
| Debug | `list_requests`, `get_request`, `explain_request` |
| Keep changes | `save_live_state`, `save_profile` |
| Remove | `delete_service`, `delete_scenario` |

Assistants are told to experiment with the live state (switching modes, applying profiles), which resets when Mimic restarts, and to only change your definition files when you ask them to build or keep something. Deleting tools are marked as destructive, so assistants ask before using them. `send_request` lets your assistant check its own work: the request goes through Mimic like your app's would, and appears in History.

## Things to try

- What's mocked in Mimic right now?
- Make the users API fail with a 500 for every request, then put it back.
- Add POST /api/orders: 201 with an order id from the request, and 422 when quantity is 0. Then test both.
- My app got a 404 for /api/users/7. Why?
- Import ./openapi.yaml into Mimic. Show me what you'd create first.
- Turn the real responses I just recorded into scenarios.

## Safety

The MCP endpoint only answers local clients. Requests from web pages (another origin) are refused, and so are requests whose host name isn't `localhost` or an IP address, which stops a malicious site from reaching it through DNS tricks. In `--read-only` mode, your assistant's changes stay in memory like any other. As with any tool you give an assistant, review what it proposes before letting it delete things.
