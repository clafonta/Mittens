#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { History } from "./core/history.js";
import { HistoryFile } from "./core/history-file.js";
import { Hooks } from "./core/hooks.js";
import { applyImport, describePlan, ImportError, parseSpec, planImport } from "./core/openapi.js";
import { ServiceMode } from "./core/schema.js";
import { FileRepo, LoadError } from "./core/repo.js";
import { Store } from "./core/store.js";
import { describeProxy, proxiedFetch, proxyFromEnv, type UpstreamProxy, usesProxy } from "./core/upstream.js";
import { watchDefinitions } from "./core/watch.js";
import { createApp } from "./http/app.js";
import { BASE } from "./http/paths.js";
import { init } from "./init.js";
import { VERSION } from "./version.js";

const pkg = { version: VERSION };

const HELP = `mimic ${pkg.version} — local HTTP mock server and recording proxy

Usage:
  mimic [start] [options]   Start the server
  mimic init [--dir <path>] Create example definitions
  mimic mcp [--url <url>]   Connect an AI assistant that launches local commands
                           (stdio) to the running Mimic; see the Assistants page
  mimic import <spec>       Create services from an OpenAPI 3 file or URL
      --dry-run            Show what would be created; write nothing
      --mode <mode>        Starting mode: static (default), dynamic or proxy
      --prefix <path>      Route prefix (default: the path of servers[0])
      --tag <tag>          Add a tag to every imported service (repeatable)

Options:
  -p, --port <n>       Port to listen on (default: 4000, env MIMIC_PORT)
      --host <addr>    Interface to bind (default: 127.0.0.1, env MIMIC_HOST)
  -d, --dir <path>     Definitions directory (default: ./mimic, env MIMIC_DIR)
      --read-only      Load definitions but never write changes to disk
      --profile <id>   Apply a profile on start, in memory only (env MIMIC_PROFILE)
  -t, --tag <tags>     Only serve services tagged with one of these (comma-separated
                       or repeated; env MIMIC_TAGS). Changeable from the dashboard.
      --no-watch       Don't reload definitions when files change
      --no-hooks       Don't run services/<id>/hook.js (or .mjs/.ts/.mts) files
      --persist-history
                       Keep request history across restarts, in
                       <dir>/.mimic/history.jsonl (env MIMIC_PERSIST_HISTORY=1)
      --history-file <path>
                       Persist history to this file instead (implies the above)
      --history-limit <n>
                       Requests kept in history (default: 500)
      --upstream-proxy <url>
                       Send proxy-mode calls through this HTTP proxy. By default
                       HTTP_PROXY / HTTPS_PROXY / NO_PROXY are honoured.
      --no-upstream-proxy
                       Ignore proxy variables; call upstreams directly
      --open           Open the dashboard in a browser on start
  -h, --help           Show this help
  -v, --version        Show the version
`;

function fail(message: string): never {
  console.error(`mimic: ${message}`);
  process.exit(1);
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      dir: { type: "string", short: "d" },
      "read-only": { type: "boolean", default: false },
      profile: { type: "string" },
      tag: { type: "string", short: "t", multiple: true },
      open: { type: "boolean", default: false },
      "no-watch": { type: "boolean", default: false },
      "no-hooks": { type: "boolean", default: false },
      "persist-history": { type: "boolean", default: false },
      "history-file": { type: "string" },
      "history-limit": { type: "string" },
      "upstream-proxy": { type: "string" },
      "no-upstream-proxy": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      "dry-run": { type: "boolean", default: false },
      mode: { type: "string" },
      prefix: { type: "string" },
      url: { type: "string" },
    },
  });

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void console.log(pkg.version);

  const command = positionals[0] ?? "start";
  const dir = path.resolve(values.dir ?? process.env.MIMIC_DIR ?? "mimic");

  if (command === "init") {
    const { created, agents, claude } = await init(dir);
    console.log(created ? `Created example definitions in ${dir}` : `${dir} already has services; left them untouched.`);
    const added = [agents === "created" && "AGENTS.md", claude === "created" && "CLAUDE.md"].filter(Boolean);
    if (added.length) console.log(`Added ${added.join(" and ")} so coding agents (Codex, Copilot, Cursor, Claude Code…) know how to edit these files.`);
    console.log(`Start with: npx @clafonta/mimic${values.dir ? ` --dir ${values.dir}` : ""}`);
    return;
  }
  if (command === "import") return importSpec(positionals[1], dir, values);
  if (command === "mcp") {
    const port = values.port ?? process.env.MIMIC_PORT ?? "4000";
    const { runBridge } = await import("./mcp/bridge.js");
    return runBridge(values.url ?? `http://127.0.0.1:${port}/_mimic/mcp`);
  }
  if (command !== "start") fail(`unknown command '${command}'. Run 'mimic --help'.`);

  const port = Number(values.port ?? process.env.MIMIC_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid port '${values.port}'`);
  const host = values.host ?? process.env.MIMIC_HOST ?? "127.0.0.1";

  const store = new Store(new FileRepo(dir), { readOnly: values["read-only"] });
  // Create the definitions directory up front so it can be watched (not in read-only mode).
  if (!existsSync(dir) && !store.readOnly) mkdirSync(dir, { recursive: true });
  try {
    await store.load();
  } catch (err) {
    fail(err instanceof LoadError ? err.message : String(err));
  }
  const profileId = values.profile ?? process.env.MIMIC_PROFILE;
  if (profileId) {
    try {
      store.applyProfile(profileId);
    } catch (err) {
      const known = store.listProfiles().map((p) => p.id);
      fail(`${err instanceof Error ? err.message : String(err)}${known.length ? ` (profiles: ${known.join(", ")})` : ""}`);
    }
  }

  const tags = store.setActiveTags((values.tag ?? (process.env.MIMIC_TAGS ? [process.env.MIMIC_TAGS] : [])).flatMap((t) => t.split(",")));
  const unknownTags = tags.filter((t) => !store.allTags().includes(t));

  const hooks = new Hooks(dir, { enabled: !values["no-hooks"], log: (m) => console.error(m) });
  await hooks.load(store.listServices().map((s) => s.id));

  const watching = !values["no-watch"] && existsSync(dir);
  const watcher = watching ? watchDefinitions(dir, store, { hooks }) : undefined;

  let upstreamProxy: UpstreamProxy = {};
  if (values["upstream-proxy"] && values["no-upstream-proxy"]) fail("use either --upstream-proxy or --no-upstream-proxy, not both");
  if (values["upstream-proxy"]) {
    try {
      new URL(values["upstream-proxy"]);
    } catch {
      fail(`invalid --upstream-proxy URL '${values["upstream-proxy"]}'`);
    }
    // Keep NO_PROXY from the environment so internal hosts still go direct.
    upstreamProxy = { httpProxy: values["upstream-proxy"], httpsProxy: values["upstream-proxy"], noProxy: proxyFromEnv().noProxy };
  } else if (!values["no-upstream-proxy"]) {
    upstreamProxy = proxyFromEnv();
  }

  const historyLimit = Number(values["history-limit"] ?? 500);
  if (!Number.isInteger(historyLimit) || historyLimit < 1) fail(`invalid --history-limit '${values["history-limit"]}'`);
  const history = new History(historyLimit);
  const historyPath = values["history-file"] ?? process.env.MIMIC_HISTORY_FILE;
  const persist = !!historyPath || values["persist-history"] || ["1", "true"].includes(process.env.MIMIC_PERSIST_HISTORY ?? "");
  let historyFile: HistoryFile | undefined;
  let restored = { restored: 0, skipped: 0 };
  if (persist) {
    // The default location gets its own .gitignore; a path you chose is left alone.
    historyFile = new HistoryFile(path.resolve(historyPath ?? path.join(dir, ".mimic", "history.jsonl")), { gitignore: !historyPath });
    try {
      restored = await historyFile.attach(history);
    } catch (err) {
      fail(`couldn't load history from ${historyFile.file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const app = createApp({ store, history, hooks, definitionsDir: dir, fetchImpl: usesProxy(upstreamProxy) ? proxiedFetch(upstreamProxy) : undefined });
  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    const origin = `http://${host.includes(":") ? `[${host}]` : host}:${info.port}`;
    const count = store.listServices().length;
    console.log(`Mimic ${pkg.version} listening on ${origin}`);
    console.log(`  Dashboard:   ${origin}${BASE}`);
    const profiles = store.listProfiles().length;
    console.log(
      `  Definitions: ${dir} (${count} service${count === 1 ? "" : "s"}, ${profiles} profile${profiles === 1 ? "" : "s"}${store.readOnly ? ", read-only" : ""})`,
    );
    if (profileId) console.log(`  Profile:     ${store.getProfile(profileId).name} (live only; YAML unchanged)`);
    if (tags.length) {
      const serving = store.listServices().filter((s) => store.isActive(s)).length;
      console.log(`  Tags:        only serving services tagged ${tags.join(", ")} (${serving} of ${count})`);
      if (unknownTags.length) console.log(`  Warning:     no service or scenario is tagged ${unknownTags.join(", ")}`);
    }
    console.log(`  Watching:    ${watching ? "on (edits to YAML reload automatically)" : "off"}`);
    if (usesProxy(upstreamProxy)) console.log(`  Upstreams:   via ${describeProxy(upstreamProxy)}`);
    const loadedHooks = hooks.summary().filter((h) => h.file);
    if (loadedHooks.length) {
      console.log(`  Hooks:       ${loadedHooks.map((h) => `${h.serviceId} (${h.exports.join(", ")})`).join(", ")}`);
    } else if (values["no-hooks"]) console.log("  Hooks:       off");
    if (historyFile) {
      const extra = restored.skipped ? `, skipped ${restored.skipped} unreadable line${restored.skipped === 1 ? "" : "s"}` : "";
      console.log(`  History:     ${historyFile.file} (restored ${restored.restored}${extra})`);
    }
    if (count === 0) console.log(`  No services yet — try 'npx @clafonta/mimic init'.`);
    if (values.open) openBrowser(`${origin}${BASE}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) =>
    fail(err.code === "EADDRINUSE" ? `port ${port} is already in use (try --port)` : err.message),
  );

  const shutdown = () => {
    watcher?.close();
    // Let queued history writes land before exiting.
    server.close(() => void (historyFile?.flush() ?? Promise.resolve()).finally(() => process.exit(0)));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function importSpec(
  source: string | undefined,
  dir: string,
  values: { "dry-run"?: boolean; mode?: string; prefix?: string; tag?: string[]; "read-only"?: boolean },
) {
  if (!source) fail("usage: mimic import <openapi.yaml|json|url> [--dir <path>] [--dry-run]");
  const mode = values.mode === undefined ? undefined : ServiceMode.safeParse(values.mode).data;
  if (values.mode !== undefined && !mode) fail(`invalid --mode '${values.mode}' (static, dynamic or proxy)`);
  if (values.prefix !== undefined && !values.prefix.startsWith("/") && values.prefix !== "") fail("--prefix must start with /");

  let text: string;
  if (/^https?:\/\//i.test(source)) {
    const proxy = proxyFromEnv();
    const res = await (usesProxy(proxy) ? proxiedFetch(proxy) : fetch)(source).catch((err: unknown) =>
      fail(`couldn't fetch ${source}: ${err instanceof Error ? err.message : String(err)}`),
    );
    if (!res.ok) fail(`couldn't fetch ${source}: HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = await readFile(path.resolve(source), "utf8").catch(() => fail(`can't read ${source}`));
  }

  const store = new Store(new FileRepo(dir), { readOnly: values["dry-run"] });
  try {
    await store.load();
  } catch (err) {
    fail(err instanceof LoadError ? err.message : String(err));
  }
  try {
    const plan = planImport(parseSpec(text), {
      mode,
      prefix: values.prefix,
      tags: (values.tag ?? []).flatMap((t) => t.split(",")).map((t) => t.trim()).filter(Boolean),
      existing: store.listServices().map((s) => ({ id: s.id, method: s.method, path: s.path })),
    });
    if (values["dry-run"]) {
      console.log(describePlan(plan, true));
      return;
    }
    const result = await applyImport(store, plan);
    console.log(describePlan(result, false));
    console.log(`Definitions: ${dir}`);
  } catch (err) {
    fail(err instanceof ImportError ? err.message : String(err));
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
