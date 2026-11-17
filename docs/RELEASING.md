# Releasing

Mittens is published to npm as `@clafonta/mittens`, from a local checkout. There is no CI, so `npm publish` does the checking: its `prepublishOnly` script runs typecheck, tests, a fresh build, and the smoke test (`scripts/smoke.mjs`), which packs the tarball, installs it into a scratch project and runs the installed CLI. If any of these fail, nothing is published.

## One-time setup

```sh
npm login        # as clafonta
npm whoami       # should print clafonta
```

## Each release

From a clean `main`:

```sh
npm version patch          # or minor / major: bumps package.json, commits, and tags vX.Y.Z
npm publish                # access is public via publishConfig; runs the checks above first
```

If your npm account uses two-factor authentication for publishing, npm asks for a one-time code.

Then check it:

```sh
npx @clafonta/mittens@latest --version
```

`npm version` creates a local git tag; there's no remote to push it to, but it marks what was released.

## Notes

- Only macOS has been tested. Linux should behave the same; Windows is the most likely to have surprises (paths, file watching). The smoke test is the quickest way to check another machine: `npm ci && npm run build && npm run smoke`.
- To try a release without publishing: `npm run build && npm run smoke`, or `npm publish --dry-run` (which also runs `prepublishOnly`).
