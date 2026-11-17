import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { describeProxy, maskProxyUrl, proxiedFetch, proxyFromEnv } from "../src/core/upstream.js";
import { setup } from "./helpers.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen(server: http.Server) {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The "real" API. */
const upstream = () =>
  listen(
    http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ path: req.url, via: req.headers["x-via"] ?? null }));
    }),
  );

/** A minimal forward proxy (CONNECT tunnels and absolute-form requests) that records what it saw. */
async function corporateProxy(opts: { auth?: string } = {}) {
  const seen: { kind: "connect" | "forward"; target: string; auth?: string }[] = [];
  const denied = (auth: string | undefined) => opts.auth !== undefined && auth !== `Basic ${Buffer.from(opts.auth).toString("base64")}`;
  const server = http.createServer((req, res) => {
    const auth = req.headers["proxy-authorization"];
    seen.push({ kind: "forward", target: req.url!, auth });
    if (denied(auth)) return void res.writeHead(407, { "proxy-authenticate": "Basic" }).end();
    const target = new URL(req.url!);
    const out = http.request(target, { method: req.method, headers: { ...req.headers, "x-via": "proxy" } }, (up) => {
      res.writeHead(up.statusCode!, up.headers);
      up.pipe(res);
    });
    req.pipe(out);
  });
  server.on("connect", (req, socket: net.Socket, head) => {
    const auth = req.headers["proxy-authorization"];
    seen.push({ kind: "connect", target: req.url!, auth });
    if (denied(auth)) return void socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n");
    const [host, port] = req.url!.split(":");
    const up = net.connect(Number(port), host!, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on("error", () => socket.destroy());
  });
  return { url: await listen(server), seen };
}

describe("proxy settings", () => {
  it("reads proxy variables, lowercase first, HTTPS falling back to HTTP", () => {
    expect(proxyFromEnv({})).toEqual({});
    expect(proxyFromEnv({ HTTP_PROXY: "http://a:1", http_proxy: "http://b:1", NO_PROXY: "localhost" })).toEqual({
      httpProxy: "http://b:1",
      httpsProxy: "http://b:1",
      noProxy: "localhost",
    });
    expect(proxyFromEnv({ HTTPS_PROXY: "http://s:1" })).toEqual({ httpsProxy: "http://s:1" });
  });

  it("masks credentials", () => {
    expect(maskProxyUrl("http://me:secret@proxy.corp:8080")).toBe("http://me:***@proxy.corp:8080");
    expect(describeProxy({ httpProxy: "http://p:1", httpsProxy: "http://p:1", noProxy: ".corp" })).toBe("http://p:1 (bypass: .corp)");
    expect(describeProxy({})).toBe("direct");
  });
});

describe("upstream calls through a corporate proxy", () => {
  it("routes proxy-mode traffic through the proxy", async () => {
    const api = await upstream();
    const proxy = await corporateProxy();
    const fetchImpl = proxiedFetch({ httpProxy: proxy.url, httpsProxy: proxy.url });
    const { request } = await setup([{ id: "api", path: "/api/*", mode: "proxy", upstream: api }], fetchImpl);

    const res = await request("/api/users/7?x=1");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe("/api/users/7?x=1");
    expect(proxy.seen).toHaveLength(1);
    expect(proxy.seen[0]!.target).toContain(new URL(api).host);
  });

  it("sends credentials from the proxy URL", async () => {
    const api = await upstream();
    const proxy = await corporateProxy({ auth: "me:s3cret" });
    const good = new URL(proxy.url);
    good.username = "me";
    good.password = "s3cret";
    const ok = await proxiedFetch({ httpProxy: good.toString() })(`${api}/x`);
    expect(ok.status).toBe(200);
    expect(proxy.seen.at(-1)!.auth).toBe(`Basic ${Buffer.from("me:s3cret").toString("base64")}`);

    // Without credentials the proxy refuses; Mittens reports the failure (or falls back to an error scenario).
    const { request, history } = await setup([{ id: "api", path: "/api/*", mode: "proxy", upstream: api }], proxiedFetch({ httpProxy: proxy.url }));
    const res = await request("/api/x");
    expect(res.status).toBe(502);
    expect(history.list()[0]!.note).toContain("407");
  });

  it("goes direct for NO_PROXY hosts", async () => {
    const api = await upstream();
    const proxy = await corporateProxy();
    const fetchImpl = proxiedFetch({ httpProxy: proxy.url, noProxy: "127.0.0.1" });
    const res = await fetchImpl(`${api}/direct`);
    expect(await res.json()).toEqual({ path: "/direct", via: null });
    expect(proxy.seen).toHaveLength(0);
  });
});
