---
name: release
description: Bump the version, write the changelog and publish a new goblin-malin release (npm + GitHub release page) by tagging. Use when the user asks to release, bump or publish a version.
argument-hint: "[patch | minor | major | x.y.z]"
disable-model-invocation: true
---

Release a new version of goblin-malin. Read [docs/RELEASING.md](../../../docs/RELEASING.md) first: it is the source of truth for how the pipeline works. This skill is the checklist to run it.

Argument: `$ARGUMENTS` — `patch`, `minor`, `major` or an explicit `x.y.z`. Empty means `patch`. If it is ambiguous for what changed (new features but "patch" asked), say so and ask.

Pushing the tag publishes to npm, which cannot be undone. Everything before the tag is reversible; do not push the tag without the user's explicit "yes" at step 7.

## 1. Get to a clean, current `main`

- `git branch --show-current` must be `main` (this project commits straight on `main`, no feature branch). If not, say so and ask; do not switch with uncommitted work in the way.
- `git fetch origin && git status -sb`: `main` must not be behind `origin/main`. Pull with `--ff-only` if it is.
- Unrelated uncommitted changes are not part of the release: leave them alone and stage only the release files.

## 2. Work out the version

- Last release: `git describe --tags --abbrev=0` (it is `v<package.json version>`; if not, stop and ask).
- Apply the argument to the `package.json` version. The tag will be `v<new version>`; check it does not exist yet (`git tag -l`, and `npm view goblin-malin versions --json` for npm).

## 3. Write the changelog

- List everything since the last tag, including direct pushes: `git log <last tag>..HEAD --no-merges --format='%h %s'`. Open a commit (`git show`) when its subject does not say what changed for the user.
- In [CHANGELOG.md](../../../CHANGELOG.md), turn `## [Unreleased]` into `## [x.y.z] — <today, YYYY-MM-DD>` and put a new empty `## [Unreleased]` above it. Merge the commits into the existing entries; do not duplicate what is already written there.
- Write for users, matching the existing entries: bold headline for a notable change, `### Added` / `### Changed` / `### Fixed`, plain words, no audit ids or file names as the only description. Leave out pure docs, tests, refactors and tooling unless a user can notice them. This text is the release page's "What's new", and the release **fails** if the section is missing or empty.

## 4. Bump the version

Set `"version"` in `package.json` to `x.y.z` (edit the file; do not run `npm version`, it would commit and tag on its own).

## 5. Check

Run `yarn type-check && yarn lint && yarn format:check && yarn test && yarn build`. Fix or report any failure; do not continue past a red check. Remember `yarn test` fails every file if the bash cwd has a lowercase drive letter: `cd "C:/Users/..."` first.

Then show the user the final CHANGELOG section as it will appear, and the result of the checks.

## 6. Commit and push to `main`

Stage only `CHANGELOG.md` and `package.json`, commit `chore(release): vx.y.z` (with the attribution line from the session), and `git push origin main`. If the user asked you to stop before pushing, stop here.

## 7. Tag — ask first

Ask the user to confirm: "Tag vx.y.z and push it? This publishes to npm." Offer the rehearsal as the alternative: push the tag, then they run Actions → Release → Run workflow with `dry_run` ticked.

Only on a clear yes: `git tag vx.y.z && git push origin vx.y.z`.

## 8. Follow it

`gh run list --workflow=release.yml --limit 1`, then `gh run watch <id>`. Report each job's result. When green, confirm with `npm view goblin-malin version` and `gh release view vx.y.z`, and give the user the release URL. If a job failed, read its log (`gh run view <id> --log-failed`) and say what broke; never retry `npm publish` by hand, and never reuse a version that reached npm (bump to the next patch).
