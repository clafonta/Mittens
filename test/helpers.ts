import { History } from "../src/core/history.js";
import { MemoryRepo } from "../src/core/repo.js";
import { type Profile, type Service, Service as ServiceSchema } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";
import { createApp } from "../src/http/app.js";

export type ServiceInput = Partial<Service> & Pick<Service, "id" | "path">;

export async function setup(services: ServiceInput[], fetchImpl?: typeof fetch, profiles: Profile[] = []) {
  const parsed = services.map((s) => ServiceSchema.parse({ name: s.id, ...s }));
  const store = new Store(new MemoryRepo(parsed, profiles));
  await store.load();
  const history = new History();
  const app = createApp({ store, history, fetchImpl });
  const request = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init);
  return { store, history, app, request };
}

export const json = { "content-type": "application/json" };

/** POST an HTML form the way a browser would (no redirect following). */
export function form(fields: Record<string, string>) {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual" as const,
  };
}

/** Two services with scenarios, for profile and form tests. */
export const fixtures = (): ServiceInput[] => [
  {
    id: "users",
    name: "Users",
    path: "/users/{id}",
    mode: "dynamic",
    defaultScenario: "ok",
    scenarios: [
      { id: "ok", name: "OK", status: 200, headers: {}, body: "ok", tags: [] },
      { id: "boom", name: "Boom", status: 500, headers: {}, body: "boom", tags: [] },
    ],
  },
  {
    id: "orders",
    name: "Orders",
    path: "/orders",
    mode: "static",
    defaultScenario: "list",
    upstream: "https://orders.test",
    scenarios: [
      { id: "list", name: "List", status: 200, headers: {}, body: "[]", tags: [] },
      { id: "down", name: "Down", status: 503, headers: {}, body: "down", tags: [] },
    ],
  },
];
