# Live state and profiles

## What changes your files, and what doesn't

Your definitions folder holds each service's **starting** mode and default scenario. While Mimic runs, each service also has a **live** state: what it's doing right now.

These change **only the live state**, kept in memory and reset when Mimic restarts:

- the mode and default-scenario switchers on the Services page
- applying a profile (dashboard, API, or `--profile` at startup)
- the tag serving filter (`--tag`, **Only serve…**)
- the `/_mimic/api/state` API

These change **the files**:

- creating, editing and deleting services, scenarios and profiles
- the Settings page
- **Save as starting state**

This way, flipping a service to "outage" to test something never leaves your working tree dirty. When a service differs from its files, it shows a **changed** label, and a banner offers:

- **Save as starting state**: write the live state into the YAML, so it's what Mimic starts with next time.
- **Reset all** (or **Reset** on one service): go back to what the files say.

If you edit a starting value in the service form, that value also becomes live straight away.

To start over completely, use **Start over** on the Settings page (or `POST /_mimic/api/reset`): it resets the live state, clears the tag filter, empties hook state and clears request history, all without touching your files.

## Profiles

A profile is a named set of settings for several services, like "happy path", "new user", or "payments down". Applying it switches all of them at once; services the profile doesn't list are left alone.

- **Create one** on the Profiles page. A new profile starts from the current state of every service, so the quickest way to make one is: set services the way you want, then **New profile**.
- **Apply one** from the Services page's profile picker, the Profiles page, `POST /_mimic/api/profiles/<id>/apply`, or `--profile <id>` at startup.
- A profile shows **active** while every service it lists has its settings.

Applying a profile changes only the live state, like the switchers. If a profile refers to a service or scenario that no longer exists, it's flagged and can't be applied until you fix it.

```yaml
# profiles/outage.yaml
name: Outage
description: Every users lookup fails with a 500.
services:
  users:
    mode: static
    scenario: server-error
```

## Slowing services down

A profile entry can also set `delayMs`, the delay before each response from that service, which is how you make a "Slow network" profile for testing loading states:

```yaml
# profiles/slow-network.yaml
name: Slow network
services:
  products: { delayMs: 1500 }
  cart: { delayMs: 1500 }
```

The delay is live state like the rest: it resets on restart, and **Save as starting state** writes it to the service. A scenario's own delay still wins over the service's. You can also set it with `PATCH /_mimic/api/state/services/<id>` and `{"delayMs": 1500}`. Services with a delay show **⏱ 1500 ms** on the Services page.

## Read-only mode

`--read-only` loads the definitions but never writes to disk: edits made in the dashboard last until Mimic stops. Useful for shared or generated definitions, and for CI.
