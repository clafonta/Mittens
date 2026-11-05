import { z } from "zod";

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

/**
 * Criteria a request must satisfy for a scenario to be chosen in dynamic mode.
 * Every criterion present must match; the scenario with the most matching
 * criteria wins.
 */
export const MatchRule = z
  .object({
    method: HttpMethod.optional(),
    /** Path params captured from the service's path template, e.g. {id}. */
    params: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.string()).optional(),
    /** Header names are compared case-insensitively. */
    headers: z.record(z.string(), z.string()).optional(),
    /** Case-insensitive substring match against the raw request body. */
    bodyContains: z.string().optional(),
  })
  .strict();
export type MatchRule = z.infer<typeof MatchRule>;

/** A scenario as stored on disk (the id comes from the file name). */
export const ScenarioFile = z
  .object({
    name: z.string().min(1),
    status: z.number().int().min(100).max(599).default(200),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().default(""),
    delayMs: z.number().int().min(0).optional(),
    match: MatchRule.optional(),
    tags: z.array(z.string()).default([]),
  })
  .strict();
export type ScenarioFile = z.infer<typeof ScenarioFile>;

export const Scenario = ScenarioFile.extend({ id: Slug });
export type Scenario = z.infer<typeof Scenario>;

/** A service as stored on disk (the id comes from the directory name). */
export const ServiceFile = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    /** Path template, e.g. /api/users/{id}. A trailing /* matches any suffix. */
    path: z.string().startsWith("/"),
    method: HttpMethod.default("ANY"),
    mode: ServiceMode.default("static"),
    defaultScenario: Slug.optional(),
    /** Returned when proxying fails or no dynamic scenario matches. */
    errorScenario: Slug.optional(),
    /** Base URL for proxy mode; the request path and query are appended. */
    upstream: z.url().optional(),
    delayMs: z.number().int().min(0).default(0),
    tags: z.array(z.string()).default([]),
  })
  .strict();
export type ServiceFile = z.infer<typeof ServiceFile>;

export const Service = ServiceFile.extend({
  id: Slug,
  scenarios: z.array(Scenario).default([]),
});
export type Service = z.infer<typeof Service>;
