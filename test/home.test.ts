import { describe, expect, it } from "vitest";
import { layoutDiagram, MAX_DIAGRAM_SERVICES } from "../src/ui/home.js";
import { Service } from "../src/core/schema.js";
import { fixtures, setup, type ServiceInput } from "./helpers.js";

const svc = (id: string, extra: Partial<ServiceInput> = {}) => Service.parse({ id, name: id, path: `/${id}`, ...extra });

describe("diagram layout", () => {
  it("places app, Mimic, services and one node per upstream host", () => {
    const l = layoutDiagram([
      svc("a", { upstream: "https://api.example.com", mode: "proxy" }),
      svc("b", { upstream: "https://api.example.com/v2" }),
      svc("c"),
      svc("d", { upstream: "https://other.test" }),
    ]);
    expect(l.services.map((s) => s.service.id)).toEqual(["a", "b", "c", "d"]);
    expect(l.upstreams.map((u) => u.host)).toEqual(["api.example.com", "other.test"]);
    expect(l.services[0]!.upstream).toMatchObject({ key: "api.example.com", live: true });
    expect(l.services[1]!.upstream).toMatchObject({ key: "api.example.com", live: false });
    expect(l.services[2]!.upstream).toBeUndefined();
    // nodes don't overlap and everything fits
    const boxes = l.services.map((s) => s.box);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.h);
    for (const b of [l.app, l.mimic, l.nomatch, ...boxes, ...l.upstreams.map((u) => u.box)]) {
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(l.height);
    }
  });

  it("groups services beyond the limit into a '+N more' node", () => {
    const many = Array.from({ length: MAX_DIAGRAM_SERVICES + 3 }, (_, i) => svc(`s${i}`));
    const l = layoutDiagram(many);
    expect(l.services).toHaveLength(MAX_DIAGRAM_SERVICES);
    expect(l.more?.count).toBe(3);
  });
});

describe("home page", () => {
  it("shows overview cards, the diagram with live counts, and recent activity", async () => {
    const services = fixtures();
    services[1]!.mode = "proxy";
    const { request } = await setup(services, (async () => new Response("up")) as typeof fetch, [
      { id: "calm", name: "Calm", description: "", services: { users: { mode: "dynamic" } } },
    ]);
    await request("/users/1");
    await request("/users/2");
    await request("/orders");
    await request("/nowhere");
    const html = await (await request("/_mimic")).text();

    // cards
    expect(html).toMatch(/Services<\/span><span class="card-value">2<\/span><span class="card-detail">0 static · 1 dynamic · 1 proxy/);
    expect(html).toMatch(/<span data-count="total">4<\/span>/);
    expect(html).toContain('<span data-count="errors">1</span> with errors');
    expect(html).toContain("Profile: Calm");
    // diagram: paths and nodes the animation script uses
    for (const id of ["p-app", "p-nomatch", "p-svc-users", "p-svc-orders", "p-up-orders", "n-mimic", "n-nomatch", "n-svc-users", "n-svc-orders"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain('data-events="/_mimic/api/events"');
    expect(html).toMatch(/data-count="users">2</);
    expect(html).toMatch(/data-count="orders">1</);
    expect(html).toMatch(/data-count="nomatch">1</);
    expect(html).toContain("proxy → orders.test");
    expect(html).toContain('href="/_mimic/services/users"');
    // recent activity and the script
    expect(html).toContain('hx-get="/_mimic/ui/history?limit=8"');
    expect(html).toContain("new EventSource");
  });

  it("marks changed and filtered-out services", async () => {
    const { request, store } = await setup(fixtures().map((s, i) => ({ ...s, tags: i === 0 ? ["a"] : ["b"] })));
    store.setLiveState("users", { mode: "static" });
    store.setActiveTags(["b"]);
    const html = await (await request("/_mimic")).text();
    expect(html).toMatch(/id="n-svc-users"[^>]*|class="node service mode-static inactive"/);
    expect(html).toContain('class="node service mode-static inactive" id="n-svc-users"');
    expect(html).toContain('<circle class="changed"');
    expect(html).toContain("1 changed");
    expect(html).toContain("serving tags: b");
  });

  it("welcomes a new project with next steps", async () => {
    const { request } = await setup([]);
    const html = await (await request("/_mimic")).text();
    expect(html).toContain("Welcome to Mimic");
    expect(html).toContain('href="/_mimic/services/new"');
    expect(html).toContain('href="/_mimic/import"');
    expect(html).not.toContain('<svg id="flow"');
  });
});

describe("events stream", () => {
  it("sends a summary of each request as it's handled", async () => {
    const { request, history } = await setup(fixtures());
    const abort = new AbortController();
    const res = await request("/_mimic/api/events", { signal: abort.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const until = async (needle: string) => {
      while (!text.includes(needle)) text += dec.decode((await reader.read()).value);
    };
    await until(": connected");
    await request("/users/9");
    await request("/_mimic/api/history", { method: "DELETE" });
    await until("event: clear");
    expect(history.listenerCount("entry")).toBe(1);
    abort.abort();
    await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    expect(history.listenerCount("entry")).toBe(0); // a closed tab doesn't leave a listener behind
    // Parse the SSE blocks rather than assume a field order.
    const events = text
      .split("\n\n")
      .map((block) => Object.fromEntries(block.split("\n").filter((l) => /^\w+: /.test(l)).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)])))
      .filter((e) => e.event);
    expect(events.map((e) => e.event)).toEqual(["request", "clear"]);
    const summary = JSON.parse(events[0]!.data!);
    expect(summary).toMatchObject({ id: events[0]!.id, method: "GET", path: "/users/9", status: 200, serviceId: "users", scenarioId: "ok", source: "fallback" });
    expect(summary).not.toHaveProperty("request");
  });
});
