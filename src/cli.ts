#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { History } from "./core/history.js";
import { FileRepo, LoadError } from "./core/repo.js";
import { Store } from "./core/store.js";
import { createApp } from "./http/app.js";
import { BASE } from "./http/paths.js";
import { init } from "./init.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const HELP = `mimic ${pkg.version} — local HTTP mock server and recording proxy

Usage:
  mimic [start] [options]   Start the server
  mimic init [--dir <path>] Create example definitions

Options:
  -p, --port <n>       Port to listen on (default: 4000, env MIMIC_PORT)
      --host <addr>    Interface to bind (default: 127.0.0.1, env MIMIC_HOST)
  -d, --dir <path>     Definitions directory (default: ./mimic, env MIMIC_DIR)
      --read-only      Load definitions but never write changes to disk
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
      open: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void console.log(pkg.version);

  const command = positionals[0] ?? "start";
  const dir = path.resolve(values.dir ?? process.env.MIMIC_DIR ?? "mimic");

  if (command === "init") {
    const { created } = await init(dir);
    console.log(created ? `Created example definitions in ${dir}` : `${dir} already has services; left untouched.`);
    console.log(`Start with: npx @clafonta/mimic${values.dir ? ` --dir ${values.dir}` : ""}`);
    return;
  }
  if (command !== "start") fail(`unknown command '${command}'. Run 'mimic --help'.`);

  const port = Number(values.port ?? process.env.MIMIC_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid port '${values.port}'`);
  const host = values.host ?? process.env.MIMIC_HOST ?? "127.0.0.1";

  const store = new Store(new FileRepo(dir), { readOnly: values["read-only"] });
  try {
    await store.load();
  } catch (err) {
    fail(err instanceof LoadError ? err.message : String(err));
  }

  const app = createApp({ store, history: new History() });
  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    const origin = `http://${host.includes(":") ? `[${host}]` : host}:${info.port}`;
    const count = store.listServices().length;
    console.log(`Mimic ${pkg.version} listening on ${origin}`);
    console.log(`  Dashboard:   ${origin}${BASE}`);
    console.log(`  Definitions: ${dir} (${count} service${count === 1 ? "" : "s"}${store.readOnly ? ", read-only" : ""})`);
    if (count === 0) console.log(`  No services yet — try 'npx @clafonta/mimic init'.`);
    if (values.open) openBrowser(`${origin}${BASE}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) =>
    fail(err.code === "EADDRINUSE" ? `port ${port} is already in use (try --port)` : err.message),
  );

  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
