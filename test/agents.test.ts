import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { AGENTS_MD, CLAUDE_MD } from "../src/agents.js";
import { History } from "../src/core/history.js";
import { FileRepo } from "../src/core/repo.js";
import { ProfileFile, ScenarioFile, ServiceFile, Settings } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";
import { createApp } from "../src/http/app.js";
import { init } from "../src/init.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});
const fresh = async () => (dir = await mkdtemp(path.join(tmpdir(), "mittens-agents-")));

describe("AGENTS.md", () => {
  it("every YAML example is valid for the file it describes", () => {
    const blocks = [...AGENTS_MD.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => YAML.parse(m[1]!) as Record<string, unknown>);
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    const kinds: string[] = [];
    for (const block of blocks) {
      if ("path" in block) (ServiceFile.parse(block), kinds.push("service"));
      else if ("services" in block) (ProfileFile.parse(block), kinds.push("profile"));
      else if ("errorScenario" in block && !("name" in block)) (Settings.parse(block), kinds.push("settings"));
      else (ScenarioFile.parse(block), kinds.push("scenario"));
    }
    expect(new Set(kinds)).toEqual(new Set(["service", "scenario", "profile", "settings"]));
  });

  it("CLAUDE.md imports it, for Claude Code", () => {
    expect(CLAUDE_MD.trim()).toBe("@AGENTS.md");
  });
});

describe("mittens init", () => {
  it("writes AGENTS.md and CLAUDE.md next to the examples", async () => {
    const root = await fresh();
    expect(await init(root)).toMatchObject({ created: true, agents: "created", claude: "created" });
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe(AGENTS_MD);
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toBe(CLAUDE_MD);
    // the files don't confuse Mittens's loader
    const store = new Store(new FileRepo(root));
    await store.load();
    expect(store.listServices().length).toBeGreaterThan(0);
  });

  it("adds them to a project that already has services, without touching anything else", async () => {
    const root = await fresh();
    await init(root);
    await rm(path.join(root, "AGENTS.md"));
    await writeFile(path.join(root, "CLAUDE.md"), "my own notes\n");
    expect(await init(root)).toMatchObject({ created: false, agents: "created", claude: "exists" });
    expect(existsSync(path.join(root, "AGENTS.md"))).toBe(true);
    expect(await readFile(path.join(root, "CLAUDE.md"), "utf8")).toBe("my own notes\n");
  });
});

describe("home page assistant panel", () => {
  async function app(withAgents: boolean) {
    const root = await fresh();
    await init(root);
    if (!withAgents) await rm(path.join(root, "AGENTS.md"));
    const store = new Store(new FileRepo(root));
    await store.load();
    const a = createApp({ store, history: new History(), definitionsDir: root });
    return { root, request: (p: string, i?: RequestInit) => a.request(`http://localhost${p}`, i), app: a };
  }

  it("invites people to connect an assistant, and mentions AGENTS.md", async () => {
    const { request, root } = await app(true);
    const html = await (await request("/_mittens")).text();
    expect(html).toContain('<span class="ap-title">Let your AI assistant set this up</span>');
    expect(html).toContain('class="button primary" href="/_mittens/assistants">Connect your AI assistant</a>');
    expect(html).toContain(`<code>${path.join(root, "AGENTS.md")}</code>`);
    expect(html).toContain("Optional, and you stay in control");
    expect(html).toContain("only accepts connections from this computer");
    const page = await (await request("/_mittens/assistants")).text();
    for (const heading of ["<strong>Optional</strong>", "<strong>Local</strong>", "<strong>In your control</strong>"]) expect(page).toContain(heading);
    expect(page).toContain("is sent to the AI service it uses");
  });

  it("suggests init when AGENTS.md is missing", async () => {
    const { request } = await app(false);
    expect(await (await request("/_mittens")).text()).toContain("to add an <code>AGENTS.md</code>");
  });

  it("shows the connected assistant", async () => {
    const { app: a, request } = await app(true);
    const client = new Client({ name: "claude-code", version: "9.9" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/_mittens/mcp"), {
        fetch: ((u: string | URL, i?: RequestInit) => a.request(String(u), i)) as typeof fetch,
      }),
    );
    const html = await (await request("/_mittens")).text();
    expect(html).toContain('<span class="pill s2">connected</span> claude-code');
    expect(html).toContain('href="/_mittens/assistants">Assistant activity</a>');
  });
});

describe("health", () => {
  it("reports a reload error so agents can check their edits", async () => {
    const root = await fresh();
    await init(root);
    const store = new Store(new FileRepo(root));
    await store.load();
    const a = createApp({ store, history: new History() });
    const health = async () => (await a.request("http://localhost/_mittens/api/health")).json() as Promise<{ reloadError: string | null }>;
    expect((await health()).reloadError).toBeNull();
    await writeFile(path.join(root, "services/users/service.yaml"), "name: Users\npath: /x\nmode: sometimes\n");
    await store.reload();
    expect((await health()).reloadError).toContain("service.yaml");
  });
});

describe("AGENTS.md path on the home page", () => {
  it("is shown relative to where Mittens was started", async () => {
    const root = path.join(process.cwd(), "test", `.tmp-agents-${process.pid}`);
    try {
      await init(root);
      const store = new Store(new FileRepo(root));
      await store.load();
      const a = createApp({ store, history: new History(), definitionsDir: root });
      const html = await (await a.request("http://localhost/_mittens")).text();
      expect(html).toContain(`<code>${path.join("test", `.tmp-agents-${process.pid}`, "AGENTS.md")}</code>`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("assistant panel: diagram and minimising", () => {
  async function home(connect: boolean) {
    const root = await fresh();
    await init(root);
    const store = new Store(new FileRepo(root));
    await store.load();
    const a = createApp({ store, history: new History(), definitionsDir: root });
    if (connect) {
      const client = new Client({ name: "claude-code", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://localhost/_mittens/mcp"), {
          fetch: ((u: string | URL, i?: RequestInit) => a.request(String(u), i)) as typeof fetch,
        }),
      );
    }
    return async (p: string) => (await a.request(`http://localhost${p}`)).text();
  }

  it("is a <details> that starts open and remembers being minimised", async () => {
    const html = await (await home(false))("/_mittens");
    expect(html).toContain('<details class="assistant-panel" id="assistant-panel" open="">');
    expect(html).toContain("optional · local · in your control");
    expect(html).toContain("localStorage.getItem(KEY) === 'collapsed'");
    expect(html).toContain("KEY = 'mittens.assistantPanel'");
    // the script follows the panel directly, so it runs before the page paints
    expect(html).toMatch(/<\/details><script>\s*\(function \(\) \{\s*var panel = document.getElementById\('assistant-panel'\)/);
  });

  it("shows what's local, what's approved, what's blocked and what leaves the computer", async () => {
    const html = await (await home(false))("/_mittens");
    for (const text of ["Your computer", "local only", "you approve", "no API keys", "Other websites", "blocked", "AI service", "your assistant&#39;s provider", "not connected"]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("t-link local active");
  });

  it("animates the local link and names the assistant once one is connected", async () => {
    const get = await home(true);
    const html = await get("/_mittens");
    expect(html).toContain('class="t-link local active"');
    expect(html).toContain('<span class="pill s2">connected</span> claude-code');
    expect(await get("/_mittens/assistants")).toContain('class="t-link local active"');
  });
});
