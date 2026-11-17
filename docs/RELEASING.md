# Releasing

Mittens is published to npm as `@clafonta/mittens`, from a local checkout. There is no CI, so `npm publish` does the checking: its `prepublishOnly` script runs typecheck, tests, a fresh build, and the smoke test (`scripts/smoke.mjs`), which packs the tarball, installs it into a scratch project and runs the installed CLI. If any of these fail, nothing is published.

## One-time setup

```sh
npm login        # as clafonta; opens npmjs.com in the browser
npm whoami       # should print clafonta
```

npm requires two-factor authentication to publish. Turn it on under Account → Two-Factor Authentication on npmjs.com. Being signed in on the website does not log in the CLI; `npm login` does.

## Each release

From a clean `main`:

```sh
npm version patch          # or minor / major: bumps package.json, commits, and tags vX.Y.Z
npm publish                # access is public via publishConfig; runs the checks above first
git push origin main --follow-tags
```

Run `npm publish` in your own terminal: after the checks pass it prints an npmjs.com link (or asks for a one-time code) to approve the upload with 2FA. A brand-new version can take a few minutes to appear on the registry.

Then check it:

```sh
npx @clafonta/mittens@latest --version
```

`npm version` creates the `vX.Y.Z` tag on the release commit; `--follow-tags` pushes it to GitHub (`origin`) along with `main`.

## Notes

- Only macOS has been tested. Linux should behave the same; Windows is the most likely to have surprises (paths, file watching). The smoke test is the quickest way to check another machine: `npm ci && npm run build && npm run smoke`.
- To try a release without publishing: `npm run build && npm run smoke`, or `npm publish --dry-run` (which also runs `prepublishOnly`).
