import { Hono } from "hono";
import { Engine } from "../core/engine.js";
import type { History } from "../core/history.js";
import { Hooks } from "../core/hooks.js";
import { Rates } from "../core/rates.js";
import type { Store } from "../core/store.js";
import { loadHelp } from "../help.js";
import { McpActivity } from "../mcp/activity.js";
import { MCP_PATH, mcpHandler } from "../mcp/http.js";
import { createApi } from "./api.js";
import { localCors, localOnly } from "./local.js";
import { mockHandler } from "./mock.js";
import { BASE } from "./paths.js";
import { createUi } from "./ui.js";

export interface AppDeps {
  store: Store;
  history: History;
  fetchImpl?: typeof fetch;
  /** Service hooks; omit for none. */
  hooks?: Hooks;
  /** The definitions folder, when there is one on disk (the dashboard checks it for AGENTS.md). */
  definitionsDir?: string;
}

export function createApp({ store, history, fetchImpl, hooks = new Hooks(undefined), definitionsDir }: AppDeps) {
  const app = new Hono();
  const engine = new Engine(store, history, fetchImpl, hooks);
  const activity = new McpActivity();
  // Everything under /_mimic is for this computer only (see local.ts); the API also answers local dev tools on other ports.
  app.use(BASE, localOnly);
  app.use(`${BASE}/*`, localOnly);
  app.use(`${BASE}/api/*`, localCors);
  app.route(`${BASE}/api`, createApi(store, history, engine, hooks));
  // MCP endpoint for AI assistants (Claude Code, Codex, Copilot, Cursor…), before the dashboard's catch-all.
  app.all(`${BASE}${MCP_PATH}`, mcpHandler({ store, history, engine, hooks, help: loadHelp(BASE), activity }));
  const rates = new Rates().attach(history);
  app.route(BASE, createUi(store, history, engine, hooks, rates, activity, definitionsDir));
  app.all("*", mockHandler(engine));
  return app;
}
