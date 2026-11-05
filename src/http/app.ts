import { Hono } from "hono";
import { Engine } from "../core/engine.js";
import type { History } from "../core/history.js";
import { Hooks } from "../core/hooks.js";
import { Rates } from "../core/rates.js";
import type { Store } from "../core/store.js";
import { createApi } from "./api.js";
import { mockHandler } from "./mock.js";
import { BASE } from "./paths.js";
import { createUi } from "./ui.js";

export interface AppDeps {
  store: Store;
  history: History;
  fetchImpl?: typeof fetch;
  /** Service hooks; omit for none. */
  hooks?: Hooks;
}

export function createApp({ store, history, fetchImpl, hooks = new Hooks(undefined) }: AppDeps) {
  const app = new Hono();
  const engine = new Engine(store, history, fetchImpl, hooks);
  app.route(`${BASE}/api`, createApi(store, history, engine, hooks));
  const rates = new Rates().attach(history);
  app.route(BASE, createUi(store, history, engine, hooks, rates));
  app.all("*", mockHandler(engine));
  return app;
}
