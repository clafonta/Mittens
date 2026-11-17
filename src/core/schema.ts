import { z } from "zod";
import { templateProblem } from "./template.js";
import { schemaProblem, STATUS_KEY } from "./validate.js";

/** Slugs double as stable IDs and as file/directory names on disk. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes only");

export const HttpMethod = z.enum(["ANY", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/**
 * - static:  always return the default scenario
 * - dynamic: pick the scenario whose `match` best fits the request
 * - proxy:   forward to `upstream` and record the exchange
 */
export const ServiceMode = z.enum(["static", "dynamic", "proxy"]);
export type ServiceMode = z.infer<typeof ServiceMode>;

const isRegex = (s: string) => {
  try {
    new RegExp(s);
    return true;
  } catch {
    return false;
  }
};

/** A regular expression test, e.g. `{ regex: "^9\\d+$" }`. Unanchored unless you add ^ / $. */
export const RegexTest = z
  .object({
    regex: z.string().min(1).refine(isRegex, "Not a valid regular expression"),
    /** Any of i, m, s, u. */
    flags: z.string().regex(/^[imsu]*$/, "Flags may only be i, m, s, u").optional(),
  })
  .strict();
export type RegexTest = z.infer<typeof RegexTest>;

/** A string compares for equality; `{ regex }` tests a regular expression. */
export const ValueTest = z.union([z.string(), RegexTest]);
export type ValueTest = z.infer<typeof ValueTest>;

/**
 * A JSONPath condition on the request body. Passes when any node the path
 * selects satisfies it:
 * - a plain value (string, number, boolean, null) — equal to the node
 * - `{ regex }` — a string or number node matches
 * - `{ exists: true|false }` — the path selects something / nothing
 */
export const JsonTest = z.union([
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
  RegexTest,
  z.object({ exists: z.boolean() }).strict(),
]);
export type JsonTest = z.infer<typeof JsonTest>;

/**
 * Criteria a request must satisfy for a scenario to be chosen in dynamic mode.
 * Every criterion present must match; the scenario with the most matching
 * criteria wins, and ties go to the one with more exact (non-regex) criteria.
 */
export const MatchRule = z
  .object({
    method: HttpMethod.optional(),
    /** Path params captured from the service's path template, e.g. {id}. */
    params: z.record(z.string(), ValueTest).optional(),
    query: z.record(z.string(), ValueTest).optional(),
    /** Header names are compared case-insensitively. */
    headers: z.record(z.string(), ValueTest).optional(),
    /** Case-insensitive substring match against the raw request body. */
    bodyContains: z.string().optional(),
    /** Regular expression tested against the raw request body. */
    bodyMatches: RegexTest.optional(),
    /** JSONPath conditions on the JSON request body, e.g. { "$.user.role": "admin" }. */
    json: z.record(z.string().startsWith("$", "JSONPath expressions start with $"), JsonTest).optional(),
  })
  .strict();
export type MatchRule = z.infer<typeof MatchRule>;

/** Proxy mode: a regex replace applied to the request path before it is sent upstream. */
export const RewriteRule = z
  .object({
    from: z.string().min(1).refine(isRegex, "Not a valid regular expression"),
    to: z.string(),
  })
  .strict();
export type RewriteRule = z.infer<typeof RewriteRule>;

/**
 * JSON Schemas for response bodies, keyed by status: "200", "2xx" or
 * "default" (most specific wins). Every response the service sends — mocked
 * or proxied — is checked and the result shown in history.
 */
export const ResponseSchemas = z
  .record(z.string().regex(STATUS_KEY, 'Keys must be a status ("404"), a class ("2xx") or "default"'), z.unknown())
  .superRefine((schemas, ctx) => {
    for (const [key, schema] of Object.entries(schemas)) {
      const problem = schemaProblem(schema);
      if (problem) ctx.addIssue({ code: "custom", path: [key], message: `Invalid JSON Schema: ${problem}` });
    }
  });

const scenarioFields = z
  .object({
    name: z.string().min(1),
    status: z.number().int().min(100).max(599).default(200),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().default(""),
    /** Render `{{ … }}` in the body and header values from the request (see template.ts). */
    template: z.boolean().optional(),
    delayMs: z.number().int().min(0).optional(),
    match: MatchRule.optional(),
    tags: z.array(z.string()).default([]),
  })
  .strict();

/** Templates are checked when saved, so a bad one is reported where it was written. */
function checkTemplates(sc: { template?: boolean; body: string; headers: Record<string, string> }, ctx: z.RefinementCtx) {
  if (!sc.template) return;
  const bodyProblem = templateProblem(sc.body);
  if (bodyProblem) ctx.addIssue({ code: "custom", path: ["body"], message: bodyProblem });
  for (const [name, value] of Object.entries(sc.headers)) {
    const problem = templateProblem(value);
    if (problem) ctx.addIssue({ code: "custom", path: ["headers"], message: `${name}: ${problem}` });
  }
}

/** A scenario as stored on disk (the id comes from the file name). */
export const ScenarioFile = scenarioFields.superRefine(checkTemplates);
export type ScenarioFile = z.infer<typeof ScenarioFile>;

export const Scenario = scenarioFields.extend({ id: Slug }).superRefine(checkTemplates);
export type Scenario = z.infer<typeof Scenario>;

/** A service as stored on disk (the id comes from the directory name). */
export const ServiceFile = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    /** Path template, e.g. /api/users/{id}. A trailing /* matches any suffix. */
    path: z.string().startsWith("/", "Must start with /"),
    method: HttpMethod.default("ANY"),
    mode: ServiceMode.default("static"),
    defaultScenario: Slug.optional(),
    /** Returned when proxying fails or no dynamic scenario matches. */
    errorScenario: Slug.optional(),
    /** Base URL for proxy mode; the request path and query are appended. */
    upstream: z.url().optional(),
    /** Proxy mode: removed from the start of the path before it is sent upstream, e.g. /mock-api. */
    stripPrefix: z.string().startsWith("/", "Must start with /").optional(),
    /** Proxy mode: applied in order after stripPrefix. */
    rewrite: z.array(RewriteRule).optional(),
    delayMs: z.number().int().min(0).default(0),
    tags: z.array(z.string()).default([]),
    responseSchema: ResponseSchemas.optional(),
  })
  .strict();
export type ServiceFile = z.infer<typeof ServiceFile>;

export const Service = ServiceFile.extend({
  id: Slug,
  scenarios: z.array(Scenario).default([]),
});
export type Service = z.infer<typeof Service>;

/** What a profile sets on one service. Omitted fields are left unchanged. */
export const ProfileEntry = z
  .object({
    mode: ServiceMode.optional(),
    /** Becomes the service's defaultScenario. */
    scenario: Slug.optional(),
    /** Service-level delay while the profile is applied, e.g. for a "Slow network" profile. */
    delayMs: z.number().int().min(0).optional(),
  })
  .strict();
export type ProfileEntry = z.infer<typeof ProfileEntry>;

/**
 * A named preset (Mockey's "service plan"): applying it sets mode and/or
 * default scenario on each listed service in one step. Unlisted services are
 * not touched.
 */
export const ProfileFile = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    services: z.record(Slug, ProfileEntry).default({}),
  })
  .strict();
export type ProfileFile = z.infer<typeof ProfileFile>;

export const Profile = ProfileFile.extend({ id: Slug });
export type Profile = z.infer<typeof Profile>;

/** A partial profile change: only the services listed change; null removes one. */
export const ProfilePatch = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    services: z.record(Slug, ProfileEntry.nullable()).optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatch>;

/** Points at one scenario of one service. */
export const ScenarioRef = z.object({ service: Slug, scenario: Slug }).strict();
export type ScenarioRef = z.infer<typeof ScenarioRef>;

/** Project-wide settings, stored in <root>/mittens.yaml. */
export const Settings = z
  .object({
    /**
     * Returned whenever Mittens would otherwise answer with its own error: no
     * service matches, no scenario matches and the service has no fallback,
     * a proxy fails without an errorScenario, and so on.
     */
    errorScenario: ScenarioRef.optional(),
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

/** All tags on a service and its scenarios, lowercased. */
export function tagsOf(service: Service): Set<string> {
  const tags = new Set(service.tags.map((t) => t.toLowerCase()));
  for (const sc of service.scenarios) for (const t of sc.tags) tags.add(t.toLowerCase());
  return tags;
}

/** True when the service or one of its scenarios carries any of the tags. */
export const hasAnyTag = (service: Service, tags: string[]) => {
  const own = tagsOf(service);
  return tags.some((t) => own.has(t.toLowerCase()));
};
