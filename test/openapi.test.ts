import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeForId, ImportError, parseSpec, planImport, sampleFor } from "../src/core/openapi.js";
import { validateResponse } from "../src/core/validate.js";
import { setup } from "./helpers.js";

const petstoreText = readFileSync(new URL("./fixtures/petstore.yaml", import.meta.url), "utf8");
const petstore = () => parseSpec(petstoreText);
const byId = (plan: ReturnType<typeof planImport>, id: string) => plan.services.find((s) => s.id === id)!;

describe("planImport (OpenAPI 3.0 fixture)", () => {
  const plan = planImport(petstore(), { tags: ["petstore"] });

  it("creates one service per operation with readable ids and the server prefix", () => {
    expect(plan.title).toBe("Petstore");
    expect(plan.services.map((s) => [s.id, s.method, s.path])).toEqual([
      ["list-pets", "GET", "/v1/pets"],
      ["create-pet", "POST", "/v1/pets"],
      ["show-pet-by-id", "GET", "/v1/pets/{pet-id}"],
      ["delete-pet", "DELETE", "/v1/pets/{pet-id}"],
      ["pet-photo", "GET", "/v1/pets/{petId}/photo.{format}"],
      ["list-categories", "GET", "/v1/categories"],
    ]);
    const list = byId(plan, "list-pets");
    expect(list).toMatchObject({ name: "List pets", mode: "static", upstream: "https://petstore.swagger.io", tags: ["pets", "petstore"], defaultScenario: "200-page-of-pets" });
  });

  it("makes a scenario per response or named example, with deterministic bodies", () => {
    const create = byId(plan, "create-pet");
    expect(create.scenarios.map((s) => [s.id, s.status, s.name])).toEqual([
      ["201-cat", 201, "201 Created (A cat)"],
      ["201-dog", 201, "201 Created (A dog)"],
      ["422-invalid-pet", 422, "422 Invalid pet"],
    ]);
    expect(JSON.parse(create.scenarios[1]!.body)).toEqual({ id: 2, name: "Rex", tag: "dog" }); // $ref'd example
    expect(create.scenarios[2]!.headers).toEqual({ "content-type": "application/problem+json" });

    const list = byId(plan, "list-pets");
    expect(list.scenarios.map((s) => [s.id, s.status])).toEqual([["200-page-of-pets", 200], ["default-unexpected-error", 500]]);
    expect(JSON.parse(list.scenarios[0]!.body)).toEqual([{ id: 1, name: "Rex", tag: "dog", owner: "Ada Lovelace", born: "2030-01-01", weight: 0.5 }]);
    expect(byId(plan, "delete-pet").scenarios).toEqual([expect.objectContaining({ id: "204-deleted", status: 204, body: "" })]);
    expect(byId(plan, "show-pet-by-id").scenarios[1]).toMatchObject({ id: "404-not-found", body: '{\n  "code": 404,\n  "message": "no such pet"\n}\n' });
  });

  it("turns response schemas into standalone JSON Schema", () => {
    const create = byId(plan, "create-pet").responseSchema as Record<string, { properties: Record<string, unknown> }>;
    expect(Object.keys(create)).toEqual(["201", "422"]);
    expect(create["201"]!.properties.owner).toEqual({ type: ["string", "null"] });
    expect(create["201"]!.properties.weight).toEqual({ type: "number", exclusiveMinimum: 0 });
    expect(Object.keys(byId(plan, "list-categories").responseSchema!)).toEqual(["2xx"]);
    expect(byId(plan, "pet-photo").responseSchema).toBeUndefined(); // not JSON
    expect(plan.warnings).toEqual(["Recursive schema '#/components/schemas/Category' is only checked to its first level"]);
  });

  it("generated and example bodies pass their own schemas", () => {
    for (const s of plan.services) {
      for (const sc of s.scenarios) {
        const check = validateResponse(s.responseSchema, sc.status, sc.body);
        if (check) expect({ id: `${s.id}/${sc.id}`, errors: check.errors }).toEqual({ id: `${s.id}/${sc.id}`, errors: [] });
      }
    }
  });

  it("skips existing ids and routes, and respects mode/prefix", () => {
    const again = planImport(petstore(), {
      prefix: "/api",
      mode: "proxy",
      existing: [
        { id: "list-pets", method: "GET", path: "/elsewhere" },
        { id: "mine", method: "DELETE", path: "/api/pets/{pet-id}" },
      ],
    });
    expect(again.skipped).toEqual([
      { id: "list-pets", route: "GET /api/pets", reason: "a service with this id already exists" },
      { id: "delete-pet", route: "DELETE /api/pets/{pet-id}", reason: "service 'mine' already handles this route" },
    ]);
    expect(again.services.every((s) => s.mode === "proxy" && s.path.startsWith("/api/"))).toBe(true);
  });
});

describe("planImport edge cases", () => {
  it("handles 3.1, relative servers, odd ids and missing operationIds", () => {
    const plan = planImport({
      openapi: "3.1.0",
      info: { title: "T" },
      servers: [{ url: "/base/" }],
      paths: {
        "/things/{thing.id}": {
          get: { responses: { "200": { description: "ok", content: { "application/json": { schema: { type: ["object", "null"], properties: { n: { type: "integer", minimum: 5 } } } } } } } },
          trace: { responses: {} },
        },
        "/new": { post: { operationId: "new", responses: { "201": { description: "made" } } } },
        "/dup": { get: { operationId: "same", responses: {} }, put: { operationId: "same", responses: {} } },
      },
    }, { mode: "proxy" });
    expect(plan.services.map((s) => [s.id, s.method, s.path])).toEqual([
      ["get-things-thing-id", "GET", "/base/things/{thing_id}"],
      ["new-op", "POST", "/base/new"],
      ["same", "GET", "/base/dup"],
      ["same-2", "PUT", "/base/dup"],
    ]);
    expect(JSON.parse(plan.services[0]!.scenarios[0]!.body)).toEqual({ n: 5 });
    expect(plan.services[0]!.mode).toBe("static"); // no absolute server URL for proxy mode
    expect(plan.warnings[0]).toContain("Proxy mode needs an absolute URL");
    expect(plan.skipped).toEqual([{ id: "", route: "TRACE /base/things/{thing_id}", reason: "TRACE isn't supported by Mimic" }]);
    expect(plan.warnings).toContain("GET /base/dup has no responses; its service has no scenarios");
  });

  it("rejects things that aren't OpenAPI 3", () => {
    expect(() => planImport({ swagger: "2.0", paths: {} })).toThrow(/Swagger 2.0 isn't supported/);
    expect(() => planImport({ openapi: "4.0.0", paths: {} })).toThrow(ImportError);
    expect(() => planImport({ openapi: "3.0.0" })).toThrow(/no paths/);
    expect(() => parseSpec("{ unbalanced: [")).toThrow(/Couldn't parse/);
  });

  it("sampleFor respects bounds and composition", () => {
    expect(sampleFor({ type: "string", minLength: 10 })).toBe("stringxxxx");
    expect(sampleFor({ type: "string", format: "uuid", maxLength: 4 })).toBe("0000");
    expect(sampleFor({ type: "integer", exclusiveMaximum: -3 })).toBe(-4);
    expect(sampleFor({ type: "array", items: { type: "boolean" }, minItems: 2 })).toEqual([true, true]);
    expect(sampleFor({ allOf: [{ properties: { a: { type: "string" } } }, { properties: { b: { const: 1 } } }] })).toEqual({ a: "string", b: 1 });
    expect(sampleFor({ oneOf: [{ type: "null" }, { type: "integer" }] })).toBe(0);
    expect(sampleFor({ type: "object", properties: { secret: { type: "string", writeOnly: true }, ok: { type: "boolean" } } })).toEqual({ ok: true });
  });
});

describe("import via API and dashboard", () => {
  it("API: dry run, then import, then nothing left to import", async () => {
    const { request, store } = await setup([]);
    const post = (q: string) => request(`/_mimic/api/import/openapi${q}`, { method: "POST", body: petstoreText });
    const dry = (await (await post("?dryRun=1&tags=petstore")).json()) as { dryRun: boolean; services: unknown[] };
    expect(dry).toMatchObject({ dryRun: true });
    expect(dry.services).toHaveLength(6);
    expect(store.listServices()).toHaveLength(0);

    const res = await post("?tags=petstore");
    expect(res.status).toBe(201);
    expect(store.listServices()).toHaveLength(6);
    expect(store.getService("list-pets").tags).toEqual(["pets", "petstore"]);

    const mock = await request("/v1/pets/3");
    expect(mock.headers.get("x-mimic-service")).toBe("show-pet-by-id");
    expect(mock.headers.get("x-mimic-validation")).toBe("pass");

    const again = (await (await post("")).json()) as { services: unknown[]; skipped: unknown[] };
    expect(again.services).toHaveLength(0);
    expect(again.skipped).toHaveLength(6);

    const bad = await request("/_mimic/api/import/openapi", { method: "POST", body: '{"swagger":"2.0"}' });
    expect(bad.status).toBe(400);
    expect((await request("/_mimic/api/import/openapi?mode=weird", { method: "POST", body: petstoreText })).status).toBe(400);
  });

  it("dashboard: upload, preview, import", async () => {
    const { request, store } = await setup([]);
    expect(await (await request("/_mimic/services")).text()).toContain('href="/_mimic/import"');
    expect(await (await request("/_mimic/import")).text()).toContain('enctype="multipart/form-data"');

    const submit = (action: string, file?: string, spec = "") => {
      const fd = new FormData();
      if (file) fd.set("file", new File([file], "petstore.yaml", { type: "application/yaml" }));
      fd.set("spec", spec);
      fd.set("action", action);
      fd.set("prefix", "/api");
      return request("/_mimic/import", { method: "POST", body: fd });
    };
    const preview = await (await submit("preview", petstoreText)).text();
    expect(preview).toContain("Would import 6 services from “Petstore”");
    expect(preview).toContain("GET /api/pets");
    expect(preview).toContain("openapi: 3.0.3"); // the uploaded spec is kept for the Import step
    expect(store.listServices()).toHaveLength(0);

    const done = await (await submit("import", undefined, petstoreText)).text();
    expect(done).toContain("Imported 6 services");
    expect(done).toContain('href="/_mimic/services/list-pets"');
    expect(store.getService("list-pets").path).toBe("/api/pets");

    const empty = await submit("preview");
    expect(empty.status).toBe(422);
    expect(await empty.text()).toContain("Choose a file or paste a spec.");
    const wrong = await submit("preview", undefined, "swagger: '2.0'");
    expect(await wrong.text()).toContain("Swagger 2.0 isn&#39;t supported");
  });
});

describe("oneOf samples", () => {
  it("picks a sample that fits exactly one option", () => {
    // Any object with message+url also fits the open second option, so only a minimal sample works.
    const schema = {
      oneOf: [
        { type: "object", required: ["message", "url"], properties: { message: { type: "string" }, url: { type: "string" } } },
        { type: "object", properties: { message: { type: "string" }, url: { type: "string" }, status: { type: "string" } } },
      ],
    };
    const sample = sampleFor(schema);
    expect(validateResponse({ default: schema }, 200, JSON.stringify(sample))!.ok).toBe(true);
  });
});

describe("import papercuts", () => {
  it("doesn't use placeholder hosts as upstreams, and says why", () => {
    const spec = (url: string) => ({ openapi: "3.1.0", info: { title: "T" }, servers: [{ url }], paths: { "/a": { get: { responses: { "200": { description: "OK" } } } } } });
    for (const url of ["https://shop.example.com/api", "https://api.example.org", "http://api.shop.test", "https://x.example", "https://nope.invalid"]) {
      const plan = planImport(spec(url));
      expect(plan.services[0]!.upstream, url).toBeUndefined();
      expect(plan.warnings[0]).toContain("placeholder host");
    }
    expect(planImport(spec("https://shop.example.com/api")).services[0]!.path).toBe("/api/a"); // the prefix is still used
    expect(planImport(spec("https://api.stripe.com/v1")).services[0]!.upstream).toBe("https://api.stripe.com");
  });

  it("names scenarios after their description, so ids aren't bare status codes", () => {
    const plan = planImport({
      openapi: "3.1.0",
      info: { title: "T" },
      paths: {
        "/a": {
          post: {
            responses: {
              "201": { description: "Created" },
              "409": { description: "Not enough stock for this product, sorry about that" },
              "500": { description: "" },
            },
          },
        },
      },
    });
    expect(plan.services[0]!.scenarios.map((s) => s.id)).toEqual(["201-created", "409-not-enough-stock", "500"]);
  });

  it("keeps ids short and whole: first clause, no filler, contractions intact", () => {
    expect(describeForId("Reviews, newest first, with the average rating")).toBe("reviews");
    expect(describeForId("The reviews service is down; the product page still works without it")).toBe("reviews-service-is-down");
    expect(describeForId("The review isn't valid")).toBe("review-isnt-valid");
    expect(describeForId("The review as stored")).toBe("review-as-stored");
    expect(describeForId("A list of the things for a user")).toBe("list-of-things");
    expect(describeForId("Payments unavailable")).toBe("payments-unavailable");
    expect(describeForId("Supercalifragilisticexpialidocious and more")).toBe("");
    expect(describeForId("")).toBe("");
  });

  it("falls back to the example's error code when the description has no words", () => {
    const plan = planImport({
      openapi: "3.1.0",
      info: { title: "T" },
      paths: {
        "/a": {
          post: {
            responses: {
              "422": { description: "—", content: { "application/json": { example: { error: "invalid_review", message: "Say more." } } } },
            },
          },
        },
      },
    });
    expect(plan.services[0]!.scenarios.map((s) => s.id)).toEqual(["422-invalid-review"]);
  });
});

describe("generated sample bodies read like data", () => {
  const review = {
    type: "object",
    required: ["id", "author", "rating", "body", "createdAt"],
    properties: {
      id: { type: "string" },
      productId: { type: "string" },
      author: { type: "string" },
      email: { type: "string" },
      rating: { type: "integer", minimum: 1, maximum: 5 },
      title: { type: "string" },
      body: { type: "string" },
      createdAt: { type: "string" },
      sku: { type: "string", pattern: "^SKU-\\d+$" },
      misc: { type: "string" },
    },
  };

  it("guesses strings from property names, unless a pattern says otherwise", () => {
    expect(sampleFor(review)).toEqual({
      id: "id-1001",
      productId: "id-1001",
      author: "Ada Lovelace",
      email: "ada@example.com",
      rating: 1,
      title: "Example title",
      body: "Some example text.",
      createdAt: "2030-01-01T00:00:00Z",
      sku: "string",
      misc: "string",
    });
  });

  it("keeps a count consistent with the list beside it", () => {
    const list = {
      type: "object",
      properties: { count: { type: "integer", minimum: 0 }, average: { type: ["number", "null"], minimum: 1 }, items: { type: "array", items: review } },
    };
    const sample = sampleFor(list) as { count: number; items: unknown[] };
    expect(sample.count).toBe(1);
    expect(sample.items).toHaveLength(1);
    // a count the schema pins down is left alone
    const pinned = { type: "object", properties: { total: { type: "integer", maximum: 0 }, items: { type: "array", items: { type: "string" } } } };
    expect(sampleFor(pinned)).toEqual({ total: 0, items: ["string"] });
  });
});
