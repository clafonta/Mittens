import { existsSync } from "node:fs";
import path from "node:path";
import { writeAgentFiles, type Written } from "./agents.js";
import { FileRepo } from "./core/repo.js";
import type { Profile, Service } from "./core/schema.js";

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
    responseSchema: {
      "2xx": {
        type: "object",
        required: ["id", "name", "email"],
        properties: { id: { type: "string" }, name: { type: "string" }, email: { type: "string", format: "email" } },
      },
      default: { type: "object", required: ["error"] },
    },
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

/** Example profiles written by `mimic init`. */
export const EXAMPLE_PROFILES: Profile[] = [
  {
    id: "happy-path",
    name: "Happy path",
    description: "Users API answers by request; httpbin goes to the real service.",
    services: { users: { mode: "dynamic", scenario: "found" }, httpbin: { mode: "proxy" } },
  },
  {
    id: "outage",
    name: "Outage",
    description: "Every users lookup fails with a 500.",
    services: { users: { mode: "static", scenario: "server-error" } },
  },
];

/**
 * Writes example definitions (unless the folder already has services) and
 * AGENTS.md / CLAUDE.md for coding agents (unless they already exist).
 */
export async function init(dir: string): Promise<{ created: boolean; dir: string; agents: Written; claude: Written }> {
  const root = path.resolve(dir);
  const files = await writeAgentFiles(root);
  if (existsSync(path.join(root, "services"))) return { created: false, dir: root, ...files };
  const repo = new FileRepo(root);
  for (const service of EXAMPLE_SERVICES) {
    await repo.saveService(service);
    for (const sc of service.scenarios) await repo.saveScenario(service.id, sc);
  }
  for (const profile of EXAMPLE_PROFILES) await repo.saveProfile(profile);
  return { created: true, dir: root, ...files };
}
