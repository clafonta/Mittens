# Hooks

When scenarios, match rules and templates aren't enough (a fake login, a list you can add to, a response that depends on yesterday's request), write a little JavaScript. Put a file called `hook.js` (or `hook.mjs`, `hook.ts`, `hook.mts`) in the service's folder, next to `service.yaml`:

```ts
// services/users/hook.ts
import type { RequestHook, ResponseHook } from "@clafonta/mittens"; // optional, for types

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
- `ctx.state`: an object for this service that keeps its contents between requests until Mittens restarts; clear it with **Clear hook state** on the service page
- `ctx.shared`: one object for every hook in the project, for state that spans services (a cart that "add to cart", "view cart" and "checkout" all use); cleared with `DELETE /_mittens/api/hooks/state`
- `ctx.live`: the service's live `mode`, `defaultScenario` and `delayMs`, and `modified`, which is true when a profile or the dashboard chose a different mode or default scenario than the files
- `ctx.log(...)`: print to Mittens's terminal, prefixed with the service id

## Hooks and profiles

A request hook runs before the service's mode and scenarios, so if it always answers, switching the service's default scenario or applying a profile has no visible effect. To let those choices win, start the hook with:

```js
if (ctx.live.modified) return; // a profile or the dashboard picked something: let that scenario answer
```

`modified` only looks at the mode and default scenario; a profile that just slows the service down doesn't count, so the hook keeps answering, slowly.

## State across services

Put state that several services need in `ctx.shared`, not in a module of your own: Mittens can't reload a module once hooks have imported it, so edits to a shared helper file need a restart (Mittens logs a reminder when such a file changes). Helpers without state, like a list of products, are fine in a shared file.

```ts
// services/add-cart-item/hook.ts
export const request: RequestHook = (req, ctx) => {
  const { productId } = req.json as { productId: string };
  const cart = (ctx.shared.cart ??= {}) as Record<string, number>;
  cart[productId] = (cart[productId] ?? 0) + 1;
  return { status: 201, body: cart };
};

// services/get-cart/hook.ts
export const request: RequestHook = (req, ctx) => ({ body: ctx.shared.cart ?? {} });
```

## When something goes wrong

- Hooks reload when you save them. If the new version doesn't load (a syntax error, say), the previous version keeps running and the service page shows the error.
- If a hook throws, returns something unexpected, or takes longer than 10 seconds, that request gets a 500 explaining why, and Mittens carries on.
- A hook stuck in an endless loop (without `await`) can't be interrupted and will freeze Mittens.

## TypeScript

`.ts` and `.mts` hooks run without a build step, using Node's built-in type stripping. Stick to syntax that can simply be erased: types and interfaces are fine; `enum` and `namespace` aren't. For editor support, `npm install -D @clafonta/mittens` and import the types as above.

## Safety

Hooks are code from your definitions folder and run with the same permissions as Mittens, like running a project's tests. Mittens lists every hook it loads at startup. Use `--no-hooks` to run definitions you don't trust without them.
