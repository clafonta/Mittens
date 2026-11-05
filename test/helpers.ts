import { History } from "../src/core/history.js";
import { MemoryRepo } from "../src/core/repo.js";
import { type Service, Service as ServiceSchema } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";
import { createApp } from "../src/http/app.js";

export type ServiceInput = Partial<Service> & Pick<Service, "id" | "path">;

export async function setup(services: ServiceInput[], fetchImpl?: typeof fetch) {
  const parsed = services.map((s) => ServiceSchema.parse({ name: s.id, ...s }));
  const store = new Store(new MemoryRepo(parsed));
  await store.load();
  const history = new History();
  const app = createApp({ store, history, fetchImpl });
  const request = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init);
  return { store, history, app, request };
}

export const json = { "content-type": "application/json" };
