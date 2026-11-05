import { Hono } from "hono";
import { Engine } from "../core/engine.js";
import type { History } from "../core/history.js";
import type { Store } from "../core/store.js";
import { createApi } from "./api.js";
import { mockHandler } from "./mock.js";
import { BASE } from "./paths.js";
import { createUi } from "./ui.js";

export interface AppDeps {
  store: Store;
  history: History;
  fetchImpl?: typeof fetch;
}

export function createApp({ store, history, fetchImpl }: AppDeps) {
  const app = new Hono();
  const engine = new Engine(store, history, fetchImpl);
  app.route(`${BASE}/api`, createApi(store, history, engine));
  app.route(BASE, createUi(store, history, engine));
  app.all("*", mockHandler(engine));
  return app;
}
