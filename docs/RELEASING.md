# Releasing

Pushing a `v*` tag runs [`release.yml`](../.github/workflows/release.yml): it checks the tag, runs CI, publishes to npm (OIDC trusted publishing, with provenance), then creates the GitHub release.

## Steps

1. **Write the changelog.** In [CHANGELOG.md](../CHANGELOG.md), rename `## [Unreleased]` to `## [x.y.z] — YYYY-MM-DD` and add a fresh empty `## [Unreleased]` above it. Write it for users (what changed for them, not file names), and cover direct-to-`main` commits too: `git log vPREVIOUS..HEAD --oneline` lists everything. This text becomes the release page, and the release fails if the section is missing.
2. **Bump the version** in `package.json` (`x.y.z`, no `v`).
3. **Check locally**: `yarn type-check && yarn lint && yarn format:check && yarn test && yarn build`, and preview the release page with `node scripts/release-notes.mjs vx.y.z` (it reads the tag's commits, so it only works once the tag exists; before that, read the CHANGELOG section).
4. **Commit and push to `main`**: `chore(release): vx.y.z`.
5. **Tag and push**: `git tag vx.y.z && git push origin vx.y.z`.
6. **Watch** Actions → Release. Nothing is published until `verify` and `check` pass. When it is green: `npm view goblin-malin version` and the [releases page](https://github.com/Tetraxel/goblin-malin/releases).

To rehearse, push the tag, then use Actions → Release → Run workflow with `dry_run` ticked: it builds and runs `npm pack --dry-run`, publishes nothing, and shows the release page text in the run summary. (If the tag is wrong, delete and re-create it before the real run: `git push --delete origin vx.y.z`.)

## The release page

[`scripts/release-notes.mjs`](../scripts/release-notes.mjs) builds it from three things:

- install instructions (npm / yarn, pinned to the released version),
- the matching CHANGELOG.md section,
- a collapsed list of **every commit** since the previous tag, so work pushed straight to `main` without a pull request still appears, plus the compare link.

## If a publish fails

npm versions cannot be reused. If `publish-npm` fails before `npm publish` ran, fix the cause and re-run the failed job. If the version is already on npm, bump to the next patch instead.
