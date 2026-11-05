import { existsSync } from "node:fs";
import path from "node:path";
import { FileRepo } from "./core/repo.js";
import type { Service } from "./core/schema.js";

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const JSON_HEADERS = { "content-type": "application/json" };

/** Example definitions written by `mimic init`. */
export const EXAMPLE_SERVICES: Service[] = [
  {
    id: "users",
    name: "Users API",
    description: "Look up a user by id. Dynamic mode picks a scenario from the path param.",
    path: "/api/users/{id}",
    method: "GET",
    mode: "dynamic",
    defaultScenario: "found",
    errorScenario: "server-error",
    delayMs: 0,
    tags: ["example"],
    scenarios: [
      {
        id: "found",
        name: "User found",
        status: 200,
        headers: JSON_HEADERS,
        body: json({ id: "42", name: "Ada Lovelace", email: "ada@example.com" }),
        tags: [],
      },
      {
        id: "not-found",
        name: "User not found",
        status: 404,
        headers: JSON_HEADERS,
        body: json({ error: "user_not_found" }),
        match: { params: { id: "404" } },
        tags: [],
      },
      {
        id: "server-error",
        name: "Server error",
        status: 500,
        headers: JSON_HEADERS,
        body: json({ error: "internal_error" }),
        match: { params: { id: "500" } },
        tags: [],
      },
    ],
  },
  {
    id: "httpbin",
    name: "httpbin (proxy)",
    description: "Proxies /anything/* to https://httpbin.org/anything/* so you can inspect real traffic in History.",
    path: "/anything/*",
    method: "ANY",
    mode: "proxy",
    upstream: "https://httpbin.org",
    delayMs: 0,
    tags: ["example"],
    scenarios: [],
  },
];

export async function init(dir: string): Promise<{ created: boolean; dir: string }> {
  const root = path.resolve(dir);
  if (existsSync(path.join(root, "services"))) return { created: false, dir: root };
  const repo = new FileRepo(root);
  for (const service of EXAMPLE_SERVICES) {
    await repo.saveService(service);
    for (const sc of service.scenarios) await repo.saveScenario(service.id, sc);
  }
  return { created: true, dir: root };
}
