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
  app.route(`${BASE}/api`, createApi(store, history));
  app.route(BASE, createUi(store, history));
  app.all("*", mockHandler(new Engine(store, history, fetchImpl)));
  return app;
}
