import { describe, expect, it } from "vitest";
import { History } from "../src/core/history.js";
import { RATE_BUCKET_MS, RATE_BUCKETS, Rates } from "../src/core/rates.js";
import { fixtures, setup } from "./helpers.js";

const T0 = 1_900_000_020_000; // a bucket boundary-ish fixed time
const entry = (serviceId: string | undefined, atMs: number, status = 200) => ({
  serviceId,
  at: new Date(atMs).toISOString(),
  response: { status, headers: {}, body: "", truncated: false },
});

describe("Rates", () => {
  it("counts requests and errors per 30-second bucket, newest last", () => {
    let now = T0;
    const rates = new Rates(() => now);
    rates.add(entry("users", now));
    rates.add(entry("users", now, 500));
    rates.add(entry("users", now - RATE_BUCKET_MS)); // previous bucket
    rates.add(entry(undefined, now, 404)); // unmatched
    const s = rates.series("users");
    expect(s.counts).toHaveLength(RATE_BUCKETS);
    expect(s.counts.slice(-2)).toEqual([1, 2]);
    expect(s.errors.slice(-2)).toEqual([0, 1]);
    expect(s.end).toBe(Math.floor(T0 / RATE_BUCKET_MS));
    expect(rates.series("").counts.at(-1)).toBe(1);
    expect(rates.series("nobody").counts.every((n) => n === 0)).toBe(true);

    // ten minutes later everything has slid out of the window
    now += RATE_BUCKETS * RATE_BUCKET_MS;
    expect(rates.series("users").counts.every((n) => n === 0)).toBe(true);
  });

  it("ignores requests older than the window, and seeds from existing history", () => {
    const now = T0;
    const rates = new Rates(() => now);
    rates.add(entry("users", now - RATE_BUCKETS * RATE_BUCKET_MS));
    expect(rates.series("users").counts.reduce((a, b) => a + b)).toBe(0);

    const history = new History();
    history.add({ ...entry("users", now), durationMs: 0, source: "scenario", request: { method: "GET", url: "http://x/", path: "/", headers: {}, body: "", truncated: false } } as never);
    const seeded = new Rates(() => now).attach(history);
    expect(seeded.series("users").counts.at(-1)).toBe(1);
  });

  it("keeps counting after history is cleared", async () => {
    const { request, history } = await setup(fixtures());
    await request("/users/1");
    history.clear();
    await request("/users/2");
    const html = await (await request("/_mimic/services")).text();
    expect(html).toMatch(/data-spark-total="users" title="2 requests in the last 10 minutes">2</);
  });
});

describe("sparklines in the dashboard", () => {
  it("appear in the services table, the service bar and the home diagram", async () => {
    const { request } = await setup(fixtures());
    await request("/users/1");
    await request("/nowhere");
    const services = await (await request("/_mimic/services")).text();
    expect(services).toContain("<th>Traffic, last 10 min</th>");
    expect(services).toMatch(/<svg class="spark" data-spark="users" data-end="\d+" data-counts="(0,){19}1" data-errors="(0,){19}0"/);
    expect(services).toContain("function slide(el)");
    const page = await (await request("/_mimic/services/users")).text();
    expect(page).toContain('data-spark="users"');
    expect(page).toContain("Traffic, last 10 min");
    const home = await (await request("/_mimic")).text();
    expect(home).toMatch(/<svg class="spark" data-spark="users"[^>]*x="\d+" y="\d+"/);
    // one live connection per page, shared by the diagram and sparklines
    expect(home.match(/new EventSource/g)).toHaveLength(1);
    expect(home).toContain("mimic:request");
  });

  it("re-rendered rows keep their sparkline", async () => {
    const { request } = await setup(fixtures());
    await request("/users/1");
    const row = await (await request("/_mimic/ui/services/users", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "mode=static&defaultScenario=ok" })).text();
    expect(row).toContain('data-spark="users"');
  });
});
