import { describe, expect, it } from "vitest";
import { upstreamPath } from "../src/core/rewrite.js";
import { form, json, setup } from "./helpers.js";

describe("upstreamPath", () => {
  it("strips a prefix only at a segment boundary", () => {
    const s = { stripPrefix: "/mock-api/" };
    expect(upstreamPath(s, "/mock-api/users/7")).toBe("/users/7");
    expect(upstreamPath(s, "/mock-api")).toBe("/");
    expect(upstreamPath(s, "/mock-apix/users")).toBe("/mock-apix/users");
    expect(upstreamPath(s, "/other")).toBe("/other");
  });

  it("applies rules in order after the prefix, with capture groups", () => {
    const s = {
      stripPrefix: "/mock",
      rewrite: [
        { from: "^/users/(\\d+)$", to: "/people/$1" },
        { from: "^/people", to: "/v2/people" },
      ],
    };
    expect(upstreamPath(s, "/mock/users/7")).toBe("/v2/people/7");
    expect(upstreamPath(s, "/mock/users/abc")).toBe("/users/abc");
  });

  it("keeps the result absolute", () => {
    expect(upstreamPath({ rewrite: [{ from: "^/api/", to: "" }] }, "/api/x")).toBe("/x");
  });
});

describe("proxy mode with rewrites", () => {
  const seen: string[] = [];
  const fetchImpl = (async (url: URL) => {
    seen.push(String(url));
    return new Response("ok");
  }) as unknown as typeof fetch;
  const service = {
    id: "users",
    path: "/mock/*",
    mode: "proxy" as const,
    upstream: "https://real.test/base/",
    stripPrefix: "/mock",
    rewrite: [{ from: "^/u/(.+)", to: "/users/$1" }],
  };

  it("sends the rewritten path, keeps the query, and notes the target in history", async () => {
    const { request, history } = await setup([service], fetchImpl);
    await request("/mock/u/7?expand=1");
    expect(seen.at(-1)).toBe("https://real.test/base/users/7?expand=1");
    expect(history.list()[0]!.note).toBe("Proxied to https://real.test/base/users/7?expand=1");
  });

  it("API previews the upstream URL", async () => {
    const { request } = await setup([service], fetchImpl);
    const res = await request("/_mimic/api/services/users/upstream?path=" + encodeURIComponent("/mock/u/9?a=b"));
    expect(await res.json()).toEqual({ url: "https://real.test/base/users/9?a=b" });
  });

  it("dashboard shows the rules and previews paths", async () => {
    const { request } = await setup([service], fetchImpl);
    const page = await (await request("/_mimic/services/users")).text();
    expect(page).toContain("strip prefix <code>/mock</code>");
    expect(page).toContain("^/u/(.+)  -&gt;  /users/$1");
    const preview = await (await request("/_mimic/ui/services/users/upstream?path=/mock/u/1")).text();
    expect(preview).toContain("https://real.test/base/users/1");
    expect(preview).not.toContain("don&#39;t reach");
    expect(await (await request("/_mimic/ui/services/users/upstream?path=/elsewhere")).text()).toContain("don&#39;t reach this service");
  });

  it("rejects invalid regexes through the API", async () => {
    const { request } = await setup([service], fetchImpl);
    const res = await request("/_mimic/api/services/users", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ rewrite: [{ from: "(", to: "x" }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Not a valid regular expression");
  });

  it("form round-trips rules and reports bad lines", async () => {
    const { request, store } = await setup([service], fetchImpl);
    const edit = await (await request("/_mimic/services/users/edit")).text();
    expect(edit).toContain("^/u/(.+) -&gt; /users/$1</textarea>");

    const base = { name: "Users", path: "/mock/*", method: "ANY", mode: "proxy", upstream: "https://real.test", delayMs: "0" };
    let res = await request("/_mimic/services/users", form({ ...base, rewrite: "no arrow here" }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Line 1: expected &quot;pattern -&gt; replacement&quot;");
    res = await request("/_mimic/services/users", form({ ...base, rewrite: "^/a -> /b\n([ -> /c" }));
    expect(await res.text()).toContain("Line 2: &quot;([&quot; is not a valid regular expression");

    res = await request("/_mimic/services/users", form({ ...base, stripPrefix: "/mock", rewrite: "^/a -> /b\n\n^/c/(.*) -> /d/$1" }));
    expect(res.status).toBe(303);
    expect(store.getDefinition("users")).toMatchObject({
      stripPrefix: "/mock",
      rewrite: [
        { from: "^/a", to: "/b" },
        { from: "^/c/(.*)", to: "/d/$1" },
      ],
    });

    // Clearing the fields removes them.
    await request("/_mimic/services/users", form(base));
    expect(store.getDefinition("users").rewrite).toBeUndefined();
    expect(store.getDefinition("users").stripPrefix).toBeUndefined();
  });
});
