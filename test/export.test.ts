import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { fixtures, json, setup } from "./helpers.js";

interface HarEntry {
  startedDateTime: string;
  request: { method: string; url: string; queryString: { name: string; value: string }[]; postData?: { mimeType: string; text: string }; bodySize: number };
  response: { status: number; statusText: string; content: { mimeType: string; text: string; size: number } };
  comment?: string;
  _mimic: { source: string; service?: string; scenario?: string };
}

describe("history export", () => {
  it("exports HAR 1.2, oldest first, as a download", async () => {
    const { request } = await setup(fixtures());
    await request("/users/1?verbose=true");
    await request("/orders", { method: "POST", headers: json, body: '{"qty":2}' });
    await request("/nowhere");

    const res = await request("/_mimic/api/history/export");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="mimic-history-\d{4}-.+\.har"$/);
    const har = (await res.json()) as { log: { version: string; creator: { name: string; version: string }; entries: HarEntry[] } };
    expect(har.log.version).toBe("1.2");
    expect(har.log.creator).toEqual({ name: "Mimic", version: VERSION });
    expect(har.log.entries.map((e) => e.request.url)).toEqual([
      "http://localhost/users/1?verbose=true",
      "http://localhost/orders",
      "http://localhost/nowhere",
    ]);

    const [get, post, missing] = har.log.entries as [HarEntry, HarEntry, HarEntry];
    expect(get.request.queryString).toEqual([{ name: "verbose", value: "true" }]);
    expect(get.request.postData).toBeUndefined();
    expect(get._mimic).toMatchObject({ source: "fallback", service: "users", scenario: "ok" });
    expect(post.request.postData).toEqual({ mimeType: "application/json", text: '{"qty":2}' });
    expect(post.request.bodySize).toBe(9);
    expect(post.response).toMatchObject({ status: 200, statusText: "OK", content: { text: "[]", size: 2 } });
    expect(missing.response.statusText).toBe("Not Found");
    expect(missing.comment).toContain("No service matches GET /nowhere");
    expect(Number.isNaN(Date.parse(get.startedDateTime))).toBe(false);
  });

  it("exports Mimic JSON and honours filters", async () => {
    const { request } = await setup(fixtures());
    await request("/users/1");
    await request("/orders");
    const res = await request("/_mimic/api/history/export?format=json&service=orders");
    expect(res.headers.get("content-disposition")).toContain('filename="mimic-history-orders-');
    const entries = (await res.json()) as { serviceId: string }[];
    expect(entries.map((e) => e.serviceId)).toEqual(["orders"]);

    expect((await request("/_mimic/api/history/export?format=xml")).status).toBe(400);
    // Unsafe service values don't reach the header.
    const odd = await request(`/_mimic/api/history/export?service=${encodeURIComponent('x"; evil')}`);
    expect(odd.headers.get("content-disposition")).not.toContain("evil");
  });

  it("dashboard links to exports", async () => {
    const { request } = await setup(fixtures());
    expect(await (await request("/_mimic/history")).text()).toContain('href="/_mimic/api/history/export?format=har"');
    expect(await (await request("/_mimic/services/users")).text()).toContain("/_mimic/api/history/export?format=har&amp;service=users");
  });
});
