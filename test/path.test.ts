import { describe, expect, it } from "vitest";
import { compilePath, matchPath } from "../src/core/path.js";

describe("compilePath / matchPath", () => {
  it("captures params", () => {
    expect(matchPath(compilePath("/api/users/{id}"), "/api/users/42")).toEqual({ id: "42" });
    expect(matchPath(compilePath("/api/users/{id}"), "/api/users/42/")).toEqual({ id: "42" });
    expect(matchPath(compilePath("/api/users/{id}"), "/api/users")).toBeNull();
    expect(matchPath(compilePath("/api/users/{id}"), "/api/users/42/posts")).toBeNull();
  });

  it("decodes params", () => {
    expect(matchPath(compilePath("/files/{name}"), "/files/a%20b")).toEqual({ name: "a b" });
  });

  it("supports trailing wildcards", () => {
    const c = compilePath("/static/*");
    expect(matchPath(c, "/static")).toEqual({});
    expect(matchPath(c, "/static/a/b.css")).toEqual({});
    expect(matchPath(c, "/staticx")).toBeNull();
  });

  it("escapes regex characters in literals", () => {
    expect(matchPath(compilePath("/v1.0/ping"), "/v1x0/ping")).toBeNull();
  });

  it("ranks literal paths above params above wildcards", () => {
    const literal = compilePath("/api/users/me").specificity;
    const param = compilePath("/api/users/{id}").specificity;
    const wildcard = compilePath("/api/users/*").specificity;
    expect(literal).toBeGreaterThan(param);
    expect(param).toBeGreaterThan(wildcard);
  });
});
