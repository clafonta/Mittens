# Proxying to real services

## Upstreams

A service in **proxy** mode forwards each request to its **upstream** URL and sends back the real response. The request's path and query are added to the upstream: with upstream `https://api.example.com`, a request for `/v1/users/7?x=1` goes to `https://api.example.com/v1/users/7?x=1`. The upstream can include a base path: `https://api.example.com/v2` sends that request to `https://api.example.com/v2/v1/users/7?x=1`.

If the call fails (refused connection, timeout after 30 s, proxy error), Mittens sends the service's error scenario, or a 502 explaining what went wrong. History records the reason either way.

## Path rewrites

Sometimes the path your app uses isn't the path the real API expects. Two settings on the service fix that:

- **Strip prefix** removes a leading part of the path, e.g. `/mock` turns `/mock/users/7` into `/users/7`. It only strips whole segments.
- **Rewrite rules** are regular-expression replacements, one `pattern -> replacement` per line, applied in order after the prefix is stripped. `$1` refers to the first capture group:

```
^/users/(\d+)$ -> /people/$1
^/v1/ -> /v2/
```

The query string is passed through unchanged. To check your rules, type a path into **Try a path** on the service page; it shows the URL Mittens would call.

## Behind a corporate proxy

Mittens's calls to upstreams honour the usual `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` environment variables (lowercase forms too), so if your shell is set up for the company proxy, Mittens is too.

- Credentials in the proxy URL (`http://user:pass@proxy.corp:8080`) are sent to the proxy and hidden in Mittens's startup output.
- `--upstream-proxy <url>` picks a proxy explicitly (`NO_PROXY` still applies).
- `--no-upstream-proxy` ignores the variables and calls upstreams directly.
- If the proxy re-signs HTTPS with a company certificate, point Node at it: `NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem npx @clafonta/mittens`.

This only affects calls Mittens makes to upstreams; requests to Mittens itself don't go through a proxy.

When an upstream call fails, the History entry shows why, e.g. `Proxy Authentication Required (407)` or `ECONNREFUSED`.
