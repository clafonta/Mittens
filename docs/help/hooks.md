# Hooks

When scenarios, match rules and templates aren't enough (a fake login, a list you can add to, a response that depends on yesterday's request), write a little JavaScript. Put a file called `hook.js` (or `hook.mjs`, `hook.ts`, `hook.mts`) in the service's folder, next to `service.yaml`:

```ts
// services/users/hook.ts
import type { RequestHook, ResponseHook } from "@clafonta/mimic"; // optional, for types

export const request: RequestHook = (req, ctx) => {
  if (!req.headers.authorization) return { status: 401, body: { error: "unauthorized" } };
  if (req.query.fail) return ctx.scenario("server-error");

  if (req.method === "POST") {
    const users = (ctx.state.users ??= []) as object[];
    users.push({ id: String(users.length + 1), ...(req.json as object) });
    return { status: 201, body: users.at(-1) };
  }
  // returning nothing carries on as usual
};

export const response: ResponseHook = (req, res) => {
  res.headers["x-request-path"] = req.path;
};
```

## The request hook

Runs when a request reaches the service, before a scenario is chosen. It can return:

- **nothing**: carry on as usual (the service's mode decides)
- **`ctx.scenario("id")`**: answer with that scenario (templates still render)
- **`{ status, headers, body, delayMs }`**: answer with this; all fields are optional, and an object body is sent as JSON

## The response hook

Runs on every response the service sends, whether it came from a scenario, a hook or a real upstream. It receives `res` as `{ status, headers, body }` (the body as text). Change it in place, or return the fields to replace. Schema validation checks the result.

## What hooks receive

`req` has `method`, `path`, `url`, `params`, `query` (first value of each), `headers` (lowercase names), `body` (text) and `json` (the parsed body, if it's JSON).

`ctx` has:

- `ctx.service`: the service, in its live state
- `ctx.scenario(id)`: see above
- `ctx.state`: an object for this service that keeps its contents between requests until Mimic restarts; clear it with **Clear hook state** on the service page
- `ctx.log(...)`: print to Mimic's terminal, prefixed with the service id

## When something goes wrong

- Hooks reload when you save them. If the new version doesn't load (a syntax error, say), the previous version keeps running and the service page shows the error.
- If a hook throws, returns something unexpected, or takes longer than 10 seconds, that request gets a 500 explaining why, and Mimic carries on.
- A hook stuck in an endless loop (without `await`) can't be interrupted and will freeze Mimic.

## TypeScript

`.ts` and `.mts` hooks run without a build step, using Node's built-in type stripping. Stick to syntax that can simply be erased: types and interfaces are fine; `enum` and `namespace` aren't. For editor support, `npm install -D @clafonta/mimic` and import the types as above.

## Safety

Hooks are code from your definitions folder and run with the same permissions as Mimic, like running a project's tests. Mimic lists every hook it loads at startup. Use `--no-hooks` to run definitions you don't trust without them.
