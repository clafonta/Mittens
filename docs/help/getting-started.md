# Getting started

## Run Mimic

You need Node.js 22.19 or newer. In your project folder:

```sh
npx @clafonta/mimic init   # writes example definitions to ./mimic
npx @clafonta/mimic        # starts on http://localhost:4000
```

The dashboard is at [http://localhost:4000/_mimic](http://localhost:4000/_mimic); your services are under **Services** ([/_mimic/services](http://localhost:4000/_mimic/services)). Everything under `/_mimic` belongs to Mimic itself; every other path is mock traffic.

Try the examples:

```sh
curl http://localhost:4000/api/users/42    # 200: the "found" scenario
curl http://localhost:4000/api/users/404   # 404: matched on the path param
curl http://localhost:4000/anything/hi     # proxied to httpbin.org
```

The dashboard's home page shows how requests flow through Mimic: your app, Mimic, each service and, for proxied services, the real API. Every request travels across it as a dot that comes back green, amber or red with its status, and the page also shows how many requests each service has answered. If you've turned on "reduce motion", nodes flash instead.

Each response carries headers saying what answered it: `x-mimic-service`, `x-mimic-scenario` and `x-mimic-source` (`scenario`, `fallback`, `proxy`, `hook`, `unmatched` or `error`).

## Point your app at Mimic

Change your app's API base URL to Mimic, keeping the path. If your app calls `https://api.example.com/v1/users/7`, point it at `http://localhost:4000` and give Mimic a service for `/v1/users/{id}`.

- **Browser apps:** Mimic answers CORS preflight requests and allows any origin, so a front end on another port can call it directly.
- **Several backends:** one Mimic can mock them all, as long as their paths don't collide. If they do, give each its own path prefix and strip it when proxying (see [path rewrites](proxying.md#path-rewrites)).
- **Mobile devices and other machines:** Mimic listens on `127.0.0.1` by default. Start it with `--host 0.0.0.0` to accept connections from elsewhere on your network.

## Make your first service

1. On the **Services** page, click **New service**.
2. Give it a name and a path such as `/api/orders/{id}`. Leave the mode as `static`.
3. Save, then click **New scenario**. Paste a JSON body and save. The first scenario becomes the service's default.
4. `curl http://localhost:4000/api/orders/1` now returns it.

Already have a running API? Put a service in `proxy` mode with the real URL as its **upstream**, use your app, then turn real responses into scenarios from History (see [Recording](recording.md)). Have an OpenAPI spec? [Import it](openapi.md).

## Where things are saved

Services, scenarios and profiles are YAML files in the definitions folder (`./mimic` unless you pass `--dir`). Commit it with your code so the whole team shares the same mocks. Edits in your editor are picked up immediately. See [Files on disk](files.md).
