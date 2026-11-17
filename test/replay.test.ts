import { describe, expect, it } from "vitest";
import { HISTORY_BODY_LIMIT } from "../src/core/engine.js";
import { fixtures, form, json, setup } from "./helpers.js";

describe("replay", () => {
  it("re-sends a recorded request through the current live state", async () => {
    const { request, store, history } = await setup(fixtures());
    await request("/users/7", { method: "POST", headers: { ...json, "x-trace": "t1" }, body: '{"a":1}' });
    const original = history.list()[0]!;
    expect(original.response.body).toBe("ok");

    store.setLiveState("users", { mode: "static", defaultScenario: "boom" });
    const res = await request(`/_mittens/api/history/${original.id}/replay`, { method: "POST" });
    expect(res.status).toBe(201);
    const replayed = (await res.json()) as { id: string; replayOf: string; request: { method: string; headers: Record<string, string>; body: string }; response: { status: number; body: string } };
    expect(replayed.replayOf).toBe(original.id);
    expect(replayed.request.method).toBe("POST");
    expect(replayed.request.headers["x-trace"]).toBe("t1");
    expect(replayed.request.body).toBe('{"a":1}');
    expect(replayed.response).toMatchObject({ status: 500, body: "boom" });
    expect(history.list()[0]!.id).toBe(replayed.id);
  });

  it("proxies replays upstream with the original body", async () => {
    const seen: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), body: new TextDecoder().decode(init.body as Uint8Array) });
      return new Response("up");
    }) as unknown as typeof fetch;
    const { request, store, history } = await setup(fixtures(), fetchImpl);
    store.setLiveState("orders", { mode: "proxy" });
    await request("/orders?page=2", { method: "PUT", body: "payload" });
    await request(`/_mittens/api/history/${history.list()[0]!.id}/replay`, { method: "POST" });
    expect(seen).toEqual([
      { url: "https://orders.test/orders?page=2", body: "payload" },
      { url: "https://orders.test/orders?page=2", body: "payload" },
    ]);
  });

  it("refuses truncated request bodies and unknown ids", async () => {
    const { request, history } = await setup(fixtures());
    await request("/users/1", { method: "POST", body: "x".repeat(HISTORY_BODY_LIMIT + 10) });
    const entry = history.list()[0]!;
    expect(entry.request.truncated).toBe(true);
    expect((await request(`/_mittens/api/history/${entry.id}/replay`, { method: "POST" })).status).toBe(409);
    expect((await request(`/_mittens/api/history/nope/replay`, { method: "POST" })).status).toBe(404);
    expect(await (await request(`/_mittens/history/${entry.id}`)).text()).toContain("can&#39;t replay");
  });

  it("dashboard: Replay button redirects to the new entry and compares responses", async () => {
    const { request, store, history } = await setup(fixtures());
    await request("/users/7");
    const original = history.list()[0]!;
    const detail = await (await request(`/_mittens/history/${original.id}`)).text();
    expect(detail).toContain(`action="/_mittens/history/${original.id}/replay"`);

    // Same live state: same response.
    let res = await request(`/_mittens/history/${original.id}/replay`, form({}));
    expect(res.status).toBe(303);
    let page = await (await request(res.headers.get("location")!.replace(/^http:\/\/localhost/, ""))).text();
    expect(page).toContain("Replay of <a");
    expect(page).toContain("Same response as the original.");

    // Changed live state: differences are listed.
    store.setLiveState("users", { mode: "static", defaultScenario: "boom" });
    res = await request(`/_mittens/history/${original.id}/replay`, form({}));
    page = await (await request(res.headers.get("location")!)).text();
    expect(page).toContain("Differs from the original");
    expect(page).toContain("body");
    expect(page).toContain("answered by users / boom (was users / ok)");

    const table = await (await request("/_mittens/ui/history")).text();
    expect(table).toContain(">replay</span>");
  });
});
