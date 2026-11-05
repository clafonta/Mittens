# Releasing

Releases are published to npm by `.github/workflows/release.yml` when a tag like `v0.2.0` is pushed. The workflow checks that the tag matches `package.json`, builds, runs the packaged-install smoke test, and runs `npm publish` (whose `prepublishOnly` runs typecheck, tests and a fresh build again).

## One-time setup

1. Create the GitHub repository, push `main`, and add a `repository` field to `package.json`, e.g.

   ```json
   "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }
   ```

   npm uses it to link the package to its source, and trusted publishing requires it to match the repository the workflow runs in.

2. Give the workflow permission to publish, either:

   - **Trusted publishing (recommended, no secrets):** on npmjs.com, open the package settings (after a first manual publish, or when creating the package) → *Trusted publisher* → GitHub Actions, with the repository and workflow file `release.yml`, environment `npm`. The workflow already requests the `id-token: write` permission this needs.
   - **Token:** create a granular npm access token with publish rights to `@laboriouslabs/mimic` and save it as the `NPM_TOKEN` repository secret.

3. Optionally, add required reviewers to the `npm` environment in the GitHub repository settings, so each release needs an approval.

The very first publish of a new package may need to be done by hand: `npm login`, then `npm publish --access public` from a clean checkout of `main`.

## Each release

```sh
npm version minor        # or patch / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags   # the tag triggers the release workflow
```

Check the run in the repository's Actions tab, then `npx @laboriouslabs/mimic@latest --version`.
