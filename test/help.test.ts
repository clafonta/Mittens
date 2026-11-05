import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { headingId, loadHelp } from "../src/help.js";
import { BASE } from "../src/http/paths.js";
import { fixtures, setup } from "./helpers.js";

const help = loadHelp(BASE);
const srcDir = path.join(import.meta.dirname, "../src");
const helpDir = path.join(import.meta.dirname, "../docs/help");

/** All files under a directory, recursively. */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** "/_mimic/help/scenarios#match-rules" -> "scenarios#match-rules" */
const helpTargets = (html: string) =>
  [...html.matchAll(/href="\/_mimic\/help\/?([\w-]*)(#[\w-]+)?"/g)].map((m) => `${m[1]}${m[2] ?? ""}`);

describe("help content", () => {
  it("lists every topic file on the home page, in order", () => {
    const files = readdirSync(helpDir).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => f.slice(0, -3)).sort();
    expect(help.topics.map((t) => t.slug).sort()).toEqual(files);
    const home = readFileSync(path.join(helpDir, "README.md"), "utf8");
    for (const slug of files) expect(home, `README.md should link ${slug}.md`).toContain(`](${slug}.md)`);
    expect(help.topics[0]!.slug).toBe("getting-started");
  });

  it("has a title on every page and no broken links between pages", () => {
    for (const topic of [help.home, ...help.topics]) {
      expect(topic.headings[0]?.depth, topic.slug).toBe(1);
      for (const target of helpTargets(topic.html)) expect(help.targets.has(target), `${topic.slug || "home"} links to ${target}`).toBe(true);
    }
  });

  it("makes GitHub-style anchors", () => {
    expect(headingId("What changes your files, and what doesn't")).toBe("what-changes-your-files-and-what-doesnt");
    expect(headingId("Recording, history and replay")).toBe("recording-history-and-replay");
    expect(headingId("The `json` filter")).toBe("the-json-filter");
  });
});

describe("contextual help links", () => {
  it("every help reference in the source points at a real topic and section", () => {
    const refs: { file: string; to: string }[] = [];
    for (const file of walk(srcDir).filter((f) => f.endsWith(".tsx"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<HelpLink to="([^"]*)"/g)) refs.push({ file, to: m[1]! });
      for (const m of text.matchAll(/\shelp="([^"]*)"/g)) refs.push({ file, to: m[1]! });
      for (const m of text.matchAll(/\$\{BASE\}\/help\/([\w-]+(?:#[\w-]+)?)/g)) refs.push({ file, to: m[1]! });
    }
    expect(refs.length).toBeGreaterThan(25);
    const broken = refs.filter((r) => !help.targets.has(r.to)).map((r) => `${path.relative(srcDir, r.file)}: ${r.to}`);
    expect(broken).toEqual([]);
  });

  it("appears on the main screens and forms, and every rendered link resolves", async () => {
    const services = fixtures();
    services[1]!.mode = "proxy";
    const { request, history } = await setup(services, (async () => new Response("up")) as typeof fetch);
    await request("/orders");
    await request("/users/1");
    await request(`/_mimic/api/history/${history.list()[0]!.id}/replay`, { method: "POST" });
    const pages = [
      "/_mimic",
      "/_mimic/services/users",
      "/_mimic/services/orders",
      "/_mimic/services/new",
      "/_mimic/services/users/edit",
      "/_mimic/services/users/scenarios/new",
      "/_mimic/services/users/scenarios/ok/edit",
      "/_mimic/profiles",
      "/_mimic/profiles/new",
      "/_mimic/history",
      `/_mimic/history/${history.list()[0]!.id}`,
      `/_mimic/history/${history.list()[2]!.id}`,
      "/_mimic/settings",
      "/_mimic/import",
    ];
    for (const p of pages) {
      const html = await (await request(p)).text();
      const targets = helpTargets(html);
      expect(targets.length, `${p} has help links`).toBeGreaterThan(0);
      for (const t of targets) expect(help.targets.has(t), `${p} links to ${t}`).toBe(true);
    }
    // Help links open in a new tab, so a half-filled form isn't lost.
    const formPage = await (await request("/_mimic/services/users/scenarios/new")).text();
    expect(formPage).toMatch(/class="help-link" href="\/_mimic\/help\/templates" target="_blank"/);
  });

  it("the empty dashboard points newcomers at Getting started", async () => {
    const { request } = await setup([]);
    expect(await (await request("/_mimic")).text()).toContain('href="/_mimic/help/getting-started"');
  });
});

describe("help pages", () => {
  it("renders every topic with navigation, and examples use the live address", async () => {
    const { request } = await setup([]);
    const home = await request("/_mimic/help");
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    expect(homeHtml).toContain("<title>Help · Mimic</title>");
    expect(homeHtml).toContain('href="/_mimic/help"');

    for (const t of help.topics) {
      const res = await request(`/_mimic/help/${t.slug}`);
      expect(res.status, t.slug).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<title>${t.title} · Help · Mimic</title>`);
      expect(html).toContain('aria-current="page"');
    }

    const started = await (await request("/_mimic/help/getting-started")).text();
    expect(started).toContain("curl http://localhost/api/users/42");
    expect(started).not.toContain("localhost:4000");
    expect(started).toMatch(/class="pager"[\s\S]*Overview[\s\S]*Services and modes/);
  });

  it("links out to other sites in a new tab", async () => {
    const { request } = await setup([]);
    expect(await (await request("/_mimic/help/scenarios")).text()).not.toContain('target="_blank" rel="noopener">template');
    expect(await (await request("/_mimic/help/openapi")).text()).toContain("Importing OpenAPI");
  });

  it("unknown topics are a friendly 404", async () => {
    const { request } = await setup([]);
    const res = await request("/_mimic/help/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("There&#39;s no help topic called &#39;nope&#39;");
  });

  it("the header links to help", async () => {
    const { request } = await setup([]);
    expect(await (await request("/_mimic/settings")).text()).toContain('class="nav-help" href="/_mimic/help"');
  });
});

