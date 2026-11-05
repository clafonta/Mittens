#!/usr/bin/env node
// Packs Mimic, installs the tarball into a temporary project the way a user
// would, and exercises the installed CLI: --version, init, import, start,
// a mock request, the dashboard, a TypeScript hook, and the bundled htmx.
// Run after `npm run build`.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const win = process.platform === "win32";
const npm = win ? "npm.cmd" : "npm";

function fail(message) {
  console.error(`smoke: FAILED: ${message}`);
  process.exit(1);
}
// When run from `npm publish --dry-run`, npm passes dry-run down through the
// environment, which would make our own `npm pack` write nothing.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "npm_config_dry_run"));

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", shell: win });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const step = (name) => console.log(`smoke: ${name}`);

if (!existsSync(path.join(root, "dist", "cli.js"))) fail("dist/ is missing; run `npm run build` first");

const work = mkdtempSync(path.join(tmpdir(), "mimic-smoke-"));
let server;
try {
  step("npm pack");
  const packed = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", work], root));
  const tarball = path.join(work, packed[0].filename);
  const files = packed[0].files.map((f) => f.path);
  for (const required of ["dist/cli.js", "dist/index.d.ts", "README.md", "LICENSE", "package.json"]) {
    if (!files.includes(required)) fail(`${required} is missing from the package`);
  }
  if (files.some((f) => f.startsWith("src/") || f.startsWith("test/"))) fail("the package includes src/ or test/");

  step("install the tarball into a fresh project");
  const app = path.join(work, "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "smoke-app", private: true, type: "module" }));
  run(npm, ["install", "--no-audit", "--no-fund", tarball], app);
  const bin = path.join(app, "node_modules", ".bin", win ? "mimic.cmd" : "mimic");
  if (!existsSync(bin)) fail("the mimic bin wasn't installed");

  step("mimic --version");
  const version = run(bin, ["--version"], app).trim();
  if (version !== pkg.version) fail(`--version printed '${version}', expected '${pkg.version}'`);

  step("mimic init and import --dry-run");
  run(bin, ["init", "--dir", "defs"], app);
  const dry = run(bin, ["import", path.join(root, "test", "fixtures", "petstore.yaml"), "--dir", "defs", "--dry-run"], app);
  if (!dry.includes("Would import 6 services")) fail(`unexpected import output:\n${dry}`);

  step("TypeScript hook using the published types");
  writeFileSync(
    path.join(app, "defs", "services", "users", "hook.ts"),
    `import type { RequestHook } from "@clafonta/mimic";
export const request: RequestHook = (req) => (req.query.smoke ? { body: { smoke: req.params.id } } : undefined);
`,
  );

  step("start the server");
  server = spawn(bin, ["--dir", "defs", "--port", "0"], { cwd: app, env, shell: win, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (d) => (output += d));
  server.stderr.on("data", (d) => (output += d));
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start:\n${output}`)), 20_000);
    const check = () => {
      const m = /listening on (http:\/\/\S+)/.exec(output);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    server.stdout.on("data", check);
    server.on("exit", (code) => reject(new Error(`server exited (${code}):\n${output}`)));
  }).catch((err) => fail(err.message));
  await new Promise((r) => setTimeout(r, 500)); // the rest of the startup lines
  if (!output.includes("Hooks:       users (request)")) fail(`the hook wasn't reported at startup:\n${output}`);

  step(`requests against ${origin}`);
  const mock = await fetch(`${origin}/api/users/42`);
  if (mock.status !== 200 || mock.headers.get("x-mimic-service") !== "users") fail(`mock request: ${mock.status} ${await mock.text()}`);
  if (mock.headers.get("x-mimic-validation") !== "pass") fail("example response didn't pass its schema");
  const hooked = await fetch(`${origin}/api/users/7?smoke=1`);
  const hookedBody = await hooked.text();
  if (hooked.headers.get("x-mimic-source") !== "hook" || hookedBody !== '{"smoke":"7"}') fail(`hook response: ${hookedBody}`);
  const dashboard = await (await fetch(`${origin}/_mimic`)).text();
  if (!dashboard.includes("<title>Services · Mimic</title>")) fail("dashboard didn't render");
  const htmx = await fetch(`${origin}/_mimic/assets/htmx.min.js`);
  if (htmx.status !== 200 || (await htmx.text()).length < 10_000) fail("htmx asset missing");

  console.log("smoke: OK");
} finally {
  if (server && server.exitCode === null) {
    if (win) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
    else server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
  }
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
