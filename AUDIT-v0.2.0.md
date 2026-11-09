# Goblin Malin — pre-release audit for `v0.2.0`

- [Goblin Malin — pre-release audit for `v0.2.0`](#goblin-malin--pre-release-audit-for-v020)
    - [1. Read this first](#1-read-this-first)
        - [Counts](#counts)
        - [Already fixed](#already-fixed)
    - [2. Findings](#2-findings)
        - [A. Build, release \& packaging](#a-build-release--packaging)
            - [REL-02 — `package.json` says `0.1.15`, but nothing was ever released under that number (registry is at `0.1.14`)](#rel-02--packagejson-says-0115-but-nothing-was-ever-released-under-that-number-registry-is-at-0114)
        - [B. Dependencies \& supply chain](#b-dependencies--supply-chain)
            - [DEP-02 — `yarn audit`: 1 advisory left (`zod` via `ytmusic-api`), no fix available](#dep-02--yarn-audit-1-advisory-left-zod-via-ytmusic-api-no-fix-available)
            - [DEP-03 — Outdated dependencies: two majors deferred](#dep-03--outdated-dependencies-two-majors-deferred)
        - [C. Data safety, persistence \& state](#c-data-safety-persistence--state)
            - [❌ DATA-09 — About 460 MB of tool binaries live under `%APPDATA%` (Roaming)](#-data-09--about-460-mb-of-tool-binaries-live-under-appdata-roaming)
        - [E. Metadata \& discovery](#e-metadata--discovery)
            - [MD-03 — MusicBrainz IDs can never be written to a saved file](#md-03--musicbrainz-ids-can-never-be-written-to-a-saved-file)
            - [MD-04 — Provider-key branching in core code contradicts the extensibility rule; hardcoded Spotify market](#md-04--provider-key-branching-in-core-code-contradicts-the-extensibility-rule-hardcoded-spotify-market)
        - [F. UI / TUI behaviour](#f-ui--tui-behaviour)
            - [UI-06 — The main layout needs ~66 columns; below that the toolbar scrolls off and columns jam together](#ui-06--the-main-layout-needs-66-columns-below-that-the-toolbar-scrolls-off-and-columns-jam-together)
        - [G. Security](#g-security)
            - [❌ SEC-02 — A copy of the secrets file sits in the repository root (kept on purpose)](#-sec-02--a-copy-of-the-secrets-file-sits-in-the-repository-root-kept-on-purpose)
        - [I. Docs, instructions \& repository hygiene](#i-docs-instructions--repository-hygiene)
            - [❌ DOC-06 — Project rules in `.claude/CLAUDE.md` are git-ignored](#-doc-06--project-rules-in-claudeclaudemd-are-git-ignored)
        - [J. Product \& UX](#j-product--ux)
            - [PROD-01 — Target-design features are still missing (for release scoping)](#prod-01--target-design-features-are-still-missing-for-release-scoping)
            - [PROD-03 — Every saved track is a FLAC, even when the source is lossy](#prod-03--every-saved-track-is-a-flac-even-when-the-source-is-lossy)
            - [PROD-04 — No cover art is ever embedded](#prod-04--no-cover-art-is-ever-embedded)
            - [PROD-05 — First-run friction observed in the live run](#prod-05--first-run-friction-observed-in-the-live-run)
        - [K. Candidates to verify (found while reading, not confirmed)](#k-candidates-to-verify-found-while-reading-not-confirmed)
    - [3. Verified OK (checked, no problem)](#3-verified-ok-checked-no-problem)
    - [4. Coverage \& limits](#4-coverage--limits)
    - [5. Side effects of this audit](#5-side-effects-of-this-audit)

|             |                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**    | 2026-11-08                                                                                                                                                                                                 |
| **Audited** | `main` @ `4db1d64` (package version `0.1.15`; npm `latest` is `0.1.14`)                                                                                                                                    |
| **Method**  | Static review + dependency/registry checks + headless TUI scenarios + throw-away repro scripts. Everything marked _verified_ was reproduced or proven from the exact code path.                            |
| **Auditor** | Claude (orchestrator) + 8 sub-agents (Sonnet 5.5, max effort). **The sub-agents were cut off by the account's 5-hour rate limit (resets 17:40 Paris time)**, see [Coverage & limits](#4-coverage--limits). |
| **Status**  | Findings that have been fixed were removed from this file: what is left is open. (Side effects of the audit are listed at the very end.)                                                                   |

---

## 1. Read this first

The two blockers found here — `yarn build` failing, and a fresh install unable to bootstrap ffmpeg/ffprobe — are **fixed** and gone from this file, like every other finding that was fully fixed (see [Already fixed](#already-fixed)). What `v0.2.0` still needs, in the order I would fix it:

| #   | ID                | Sev. | One-liner                                                                     |
| --- | ----------------- | ---- | ----------------------------------------------------------------------------- |
| 1   | [DEP-02](#dep-02) | low  | 1 `yarn audit` advisory left (`zod` via `ytmusic-api`); it waits for upstream |

### Counts

<!-- COUNTS-TABLE -->

| Area                                       | blocker |  high | medium |   low |  total |
| ------------------------------------------ | ------: | ----: | -----: | ----: | -----: |
| Build, release & packaging (`REL-`)        |         |       |        |     1 |      1 |
| Dependencies & supply chain (`DEP-`)       |         |       |        |     2 |      2 |
| Data safety, persistence & state (`DATA-`) |         |       |      1 |       |      1 |
| Metadata & discovery (`MD-`)               |         |       |      1 |     1 |      2 |
| UI / TUI behaviour (`UI-`)                 |         |       |        |     1 |      1 |
| Security (`SEC-`)                          |         |       |        |     1 |      1 |
| Docs, instructions & hygiene (`DOC-`)      |         |       |        |     1 |      1 |
| Product & UX (`PROD-`)                     |         |       |      3 |     1 |      4 |
| **Total**                                  |   **0** | **0** |  **5** | **8** | **13** |

Plus 8 unconfirmed candidates in [section K](#k-candidates-to-verify-found-while-reading-not-confirmed) (not counted).

<!-- /COUNTS-TABLE -->

### Already fixed

Removed from this file once fixed and committed (what was found, the fix and how it was checked are in the file's git history: `git log -p -- AUDIT-v0.2.0.md`): **REL-01** (`yarn build`), **REL-04** (`engines`), **REL-05** (`postinstall`), **DEP-01** (unused dependencies), **DATA-01** ("Clear temporary downloads"), **DATA-02** and **DATA-03** (`sessions.json` / `settings.json` validation, quarantine, `.bak`, versioning), **DATA-04** (the data folder is derived, never stored), **DATA-05** (visible write failures, bounded retry on close, unique temp names, one instance per data folder), **DATA-06** (self-update exits through `exitApp()`), **DATA-07** (crash/signal handlers restore the terminal and save; console patch moved to the entry points), **MD-01** (confidence normalisation keeps every script and strips only accents; empty names score 0; live/remix/karaoke/cover versions are penalised; `tests/unit/confidence.test.ts`), **MD-02** (scraped Spotify answers are never cached; "nothing found" discovery results are kept 1 day, not 90; concurrent identical calls share one request; `tests/unit/cache.test.ts` — caches written before the fix may still hold old entries until they expire or "Clear cache"), **REL-06** (no more `prepack`/`postpack`: the README carries absolute image URLs, `patch-readme.mjs` is gone), **SEC-01** (`openUrl` spawns the native opener with an argv array — no shell, http(s) only; the updater takes a program + args from `getUpdateArgv`, with the version validated as semver, and uses a shell only on Windows for the `.cmd` shims; `tests/unit/shellSafety.test.ts`), **UI-01** (a link pasted into a focused text field stays in the field; scheme-less links and `spotify:` URIs are understood), **UI-02** (`Ctrl+Q`, rebindable `global.quit`, asks first; a second press quits at once), **DOC-02** (`.env.example`), **DOC-05** (`TODO.md`), **DOC-07** (`CHANGELOG.md`, `.gitattributes` with `* text=auto eol=lf`, `.nvmrc`, `SECURITY.md`, `homepage`/`bugs` in `package.json`; the README already states the licence terms, and `"license": "SEE LICENSE IN LICENSE"` stays because Yarn rejects the PolyForm SPDX id; the audio-sample licence check and the untracked root notes moved to `TODO.md`), **DOC-01** (`docs/audit/*` is deleted; `docs/ARCHITECTURE.md` is a short, current map and `CLAUDE.md` points to it), **DOC-03** (the README has the feature list, install notes per OS, first run, the keyboard table, how to quit, data and log locations per OS, `GOBLIN_DATA_DIR`, privacy, troubleshooting and the licence; `yarn global add` is flagged as Yarn 1 only), **DOC-04** (`docs/projects/p20`, `p20b` and `p22` no longer link to removed files and carry a historical note; a link checker over all the markdown files finds no other dead link), **PROD-02** (dotenv banner), **DATA-08** (temporary downloads are cleaned by how recently a session used them — manual age picker, start-up reminder, opt-in 48 h auto-clean, size row in Settings, sources marked "File not found" after a clean-up; the dead `autoDeleteTempAfter24h`, `autoSaveToOutputDir` and `autoRelocateMissingFiles` settings are gone; moving the default folder out of the Music library and deleting unselected candidates after a save are in `TODO.md`), the ffmpeg/ffprobe bootstrap bug and then the rest of **DL-01** (yt-dlp and ffmpeg downloads are SHA-256-verified when the vendor publishes a checksum list and only warn when it can't be fetched; mpv, whose vendor publishes none, is not verified; `mpv-setup.ts` is on `#utils/http`; ffmpeg and ffprobe share one archive download), **DATA-10** (the log file gets a task id instead of the whole task, `Error`s are serialised, and the previous session's log is kept as `app.prev.log` instead of being truncated; 10 MB cap per file), and most of **DEP-02** / **DEP-03** (`yarn audit` 97 → 1: every minor/patch bump plus a refresh of the transitive dependencies clears the `axios`, `ws`, `vite`, `js-yaml`, babel chains without any `resolutions`; `adm-zip` 0.6.1, which ships its own types so `@types/adm-zip` is gone; `ink` 8 (no more `ws`; two type-only fixes for its generic `stdout`), `react` 19.3, `musicbrainz-api` 2 (checked live: ISRC search, name search, lookup), `vitest` 5 (with `vite` now declared, it is no longer bundled), `tsup` 9 (`esbuild` 0.28), `dotenv` 18, `strip-ansi` 7, `@types/node` 26, `slsk-client` 2 (a new promise-based API: `SoulseekService` ported, its own typings replace `src/types/slsk-client.d.ts`; downloads are now really cancelled, so the abandon-and-sweep-orphan-files workaround is gone, and rows show download progress); one dev-only `resolutions` entry moves `@typescript-eslint/typescript-estree`'s `minimatch` to 11), and **REL-07** (the hidden swc build path is gone: `emitDecoratorMetadata` is off — nothing read `design:*` metadata — so tsup no longer loads `@swc/core`, which is removed; `@typescript-eslint/consistent-type-imports` is an error in `yarn lint` (the ~360 existing violations were auto-fixed to `import type`), and `yarn check:utf8` (`scripts/check-utf8.mjs`) runs in CI before the build; and, before that, the Windows exe was dropped — `npm install -g goblin-malin` is the only install path: `build-sea.mjs`, `package:win`, `postject`, the `pkg`-era `patch-pkg-compat.mjs` and the release workflow's exe job are gone, the update modal lost its exe branch; the exe build had been broken since `a4266c0` anyway, top-level `await` in `src/cli.ts`). Also fixed: **UI-03** (the import clipboard is read asynchronously through `clipboardy`, with a visible message when it is empty or unreadable), **UI-04** (the read-only settings row keeps its label and truncates only the value), **UI-05** (the empty-state hint shows the live `global.import` binding) and **UI-07** (the task cursor is clamped and stale multi-selected ids are pruned whenever the task list changes; `tests/unit/reconcileTaskSelection.test.ts`). **TEST-01** (`yarn type-check` also checks `tests/` and the TUI harness through `scripts/tui-test/tsconfig.json`; `yarn lint` and `yarn format:check` cover `tests/` and `scripts/`, and CI runs `format:check`; Prettier now keeps each file's line endings, so Windows checkouts are no longer all "wrong"; the harness type-check had been broken for aliases and `__APP_VERSION__`, and linting the tests found Windows paths such as `"C:	mp.flac"` written with single backslashes, i.e. with a tab and a bell in them). **TEST-02** (every TUI scenario, e2e tests included, runs on a throwaway copy of its fixture in a temp folder, with the music folders pointed inside the copy: the real data folder, the tracked fixtures and `~/Music` are never touched, and the e2e tests that failed on a clean `main` because of the "temporary downloads" dialog now pass; a scenario without `dataDir` starts from `fixtures/empty`; `GOBLIN_TUI_KEEP_DATA=1` keeps the copy), **TEST-03** (`navigate-settings.json` presses → three times and asserts on `Search settings`, text only the modal shows), **TEST-05** (new tests for the shortcut registry and `matchesShortcut`, the updater — `isNewer`, `checkForUpdate`, installer detection — `envFile`, `useFocusManager` and `useDebouncedValue`; a `mountHook` helper runs a hook in a headless Ink tree; `yarn test:coverage` prints a coverage summary and CI runs it with the unit tests; no threshold is enforced). **TEST-04** (the harness emulator loads `@xterm/addon-unicode11` and switches to Unicode 11 widths, so emoji take 2 cells as in the app: the toolbar row of a harness snapshot no longer ends in a spurious `││`; checked on `collection-import.json` before and after). **REL-03** (every action in `ci.yml` and `release.yml` is pinned to a full commit SHA with its version as a comment, within the major already in use — `checkout` and `setup-node` v4.4.0, `action-gh-release` v2.6.2; `.github/dependabot.yml` bumps them monthly through the `github-actions` ecosystem only, npm dependencies stay manual; the pinned release workflow still has to be rehearsed with a `dry_run`, see REL-02). Findings that were only partly fixed (**DEP-02**, **DEP-03**) keep just the part that is still open.

---

## 2. Findings

Legend — **Severity** (for a v0.2.0 release): `blocker` data loss / crash in a normal flow / cannot build or install · `high` serious bug or risk in a main flow · `medium` real bug or risk with narrower reach · `low` polish. **Confidence**: `verified` reproduced or proven from the exact code · `reported` found by a sub-agent with reproduction, spot-checked by me · `likely` strong reading, not reproduced · `unverified` candidate to confirm.

### A. Build, release & packaging

<a id="rel-02"></a>

#### REL-02 — `package.json` says `0.1.15`, but nothing was ever released under that number (registry is at `0.1.14`)

**low · packaging · verified (GitHub API + npm registry)**

- **Where:** `.github/workflows/release.yml`, `package.json:3` (`0.1.15`).
- **What:** npm `latest` is `0.1.14` (published 2026-06-18); GitHub releases stop at `v0.1.14`. The only Actions run for tag `v0.1.15` ended `failure` (annotation: `src/index.tsx … 'typeof globalThis' has no index signature`, a build break that is since fixed). _Update: the owner has since deleted the `v0.1.15` tag, which removes the "burnt tag" problem; the failed run stays in the Actions history, which is harmless._ 31 commits (≈ 233 files, +14k/−1.4k lines) have landed since `0.1.14`, so users on npm/the exe are ~4.5 months behind `main`.
- **Impact:** only a version-number inconsistency now: a local checkout reports `0.1.15` (and `APP_VERSION`/the update check use it) while the registry is at `0.1.14`.
- **Fix:** bump to `0.2.0` in the release commit and tag `v0.2.0` only after a green dry-run. Also check what the in-app updater does for users whose installed version is higher than the latest release.

### B. Dependencies & supply chain

<a id="dep-02"></a>

#### DEP-02 — `yarn audit`: 1 advisory left (`zod` via `ytmusic-api`), no fix available

**low · security · verified (`yarn audit`, 2026-11-08)**

- **Where:** `ytmusic-api` 5.3.1 (the latest release) → `zod` `^3.23.8` (3.25.76). The advisory ("Zod can exhaust memory while validating oversized constrained…", high) is fixed only in `zod ≥ 4.6.6`; there is no patched 3.x.
- **What:** a `resolutions` entry to zod 4 would break `ytmusic-api`: it imports `ZodFirstPartyTypeKind`, a zod 3 internal that zod 4 no longer exports. It only validates YouTube Music's own responses (fixed URLs), so exposure is low.
- **Fix:** wait for a `ytmusic-api` release on zod 4 (or replace the library), then bump. Also: drop the dev-only `resolutions` entry for `**/@typescript-eslint/typescript-estree/minimatch` once `typescript-eslint` itself depends on `minimatch ≥ 11.0.1`.

<a id="dep-03"></a>

#### DEP-03 — Outdated dependencies: two majors deferred

**low · deps · verified (`yarn outdated`, 2026-11-08)**

Everything else is on its latest version. Left, each tried and backed out:

- **`eslint` / `@eslint/js` 9 → 10:** `eslint-plugin-react` 7.37.5 (latest) does not support ESLint 10 (its peer range stops at `^9.7`) and crashes on `settings.react.version: "detect"` (`contextOrFilename.getFilename is not a function`). With a fixed `version` it runs, but the new recommended `preserve-caught-error` rule reports 14 errors (`throw new Error(…)` in a `catch` without `{ cause }`). Do it when the plugin supports v10, together with adding the `cause`s.
- **`typescript` 6 → 7:** `typescript-eslint` 8.72.1 requires `typescript <6.1.0`. Wait for it.

### C. Data safety, persistence & state

<a id="data-09"></a>

#### ❌ DATA-09 — About 460 MB of tool binaries live under `%APPDATA%` (Roaming)

**❌❌❌ WON'T DO ❌❌❌** — the owner decided to keep this as is.

**medium · product · verified for sizes; the Roaming consequence is likely**

- **Where:** `src/constants.ts:12-19`, `src/utils/{ffmpeg,ffprobe,mpv}-setup.ts`, `…/ytdlp-setup.ts`.
- **What:** `data/bin` on the dev machine: `ffmpeg` 163 MB + `ffprobe` 163 MB (the full GPL build ships both at full size) + `mpv` 113 MB + `yt-dlp` 23 MB, with date-stamped file names. On roaming-profile / OneDrive-redirected setups ~0.5 GB of executables gets synced; `%LOCALAPPDATA%` is the right place for binaries and caches. (The real installed-app folder `%APPDATA%/goblin-malin/bin` already holds 270 MB.)
- **Fix:** `%LOCALAPPDATA%` / `~/Library/Caches` / `$XDG_CACHE_HOME` for `bin/` and `cache/`; consider an audio-only ffmpeg build or the system ffmpeg; document the footprint.

### E. Metadata & discovery

<a id="md-03"></a>

#### MD-03 — MusicBrainz IDs can never be written to a saved file

**medium · product · verified by reading**

- **Where:** `src/flows/musicDownloadFlow/saveSettings.ts:36-42` (`getSaveSettings()` hard-codes `includeMusicBrainzTags: false`), `…/utils/compiledMetadataToTags.ts:20`, `…/utils/downloadTask.ts:989`.
- **What:** the app discovers MusicBrainz recording/release/artist IDs and shows them in the panels, but the "include MusicBrainz IDs in tags" option is a constant `false` with no setting or UI behind it (the former `README-TARGET` promised an "Include MusicBrainz tags" checkbox; `TODO.md` lists "Set MusicBrainzReleaseId" as a release blocker). Saved files therefore never carry MBIDs — the main reason to involve MusicBrainz in a tagger (Picard/Navidrome matching).
- **Fix:** expose it as a setting (default on, as the former `README-TARGET` promised) and wire `getSaveSettings()` to it; decide the scope of the "release id" blocker.

<a id="md-04"></a>

#### MD-04 — Provider-key branching in core code contradicts the extensibility rule; hardcoded Spotify market

**low · maintainability · verified**

- **Where:** `src/flows/musicDownloadFlow/contextualActions.ts:398,405` (`serviceKey === "musicBrainz"`), `…/utils/downloadTask.ts:690` (`platform === "youtubeMusic"`), `…/claude/convertClaudeToTrack.ts:20-22`, `…/spotify/SpotifyService.ts:465` (`"FR"` market, with a `TODO`), stale TODO in `…/musicbrainz/MusicBrainzService.ts:9` ("once MusicBrainz is activated").
- **What:** `CLAUDE.md` says "never branch on a provider key"; these places do. The hardcoded market affects availability/relinking of tracks for non-French users.
- **Fix:** move the Picard special-case into a static capability of the service class; make the market a setting (default: the account's country).

### F. UI / TUI behaviour

<a id="ui-06"></a>

#### UI-06 — The main layout needs ~66 columns; below that the toolbar scrolls off and columns jam together

**low · ux (layout) · verified (harness sweep on a copy of the 50-task fixture)**

- **What:** sizes tested: 100×30, 80×24, 76/72/68×24 are fine; at **64×24** and **60×20** rows are wider than the terminal, wrap (`No s` / `ta…`) and push the toolbar/header out of the screen (the top of the snapshot is a task row); at 50×16, 40×12 the columns collapse (`4v…wg…✓ 0No sta…`); 30×10 and 20×8 are unreadable. No crash, no exception at any size (`exitCode` stays `null`, no stack text), but also no "terminal too small" message or minimum-size guard (the Settings modal degrades more gracefully than the main screen).
- **Impact:** split panes (tmux, Windows Terminal) narrower than ~66 columns show a broken screen with no hint why.
- **Fix:** below a minimum (e.g. 66×16) render a single line "Terminal too small — need at least 66×16 (now W×H)"; hide low-priority columns (SPOTIFY/YOUTUBE/MB) progressively; see the `flexShrink` guidance in `CLAUDE.md`.

### G. Security

<a id="sec-02"></a>

#### ❌ SEC-02 — A copy of the secrets file sits in the repository root (kept on purpose)

**❌❌❌ WON'T DO ❌❌❌** — the owner decided to keep this as is.

**low · security · verified (key names only inspected — values never read)**

- **Where:** `(copie).env` (repo root; matches `*.env` in `.gitignore`, not in npm `files`).
- **What:** it holds `SOULSEEK_USERNAME`, `SOULSEEK_PASSWORD`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` in plaintext, next to the source. The owner wants to keep it, which is fine: it is safe from git and npm as long as the `*.env` pattern in `.gitignore` and the `files` whitelist in `package.json` stay as they are. The folder lives under `Documents` (a `.tmp.driveupload` folder suggests a sync client), so the secrets may be uploaded by that client.
- **Fix (optional):** nothing required. If you want a little more safety, keep such copies outside the repository folder (or outside synced folders), and rotate the Spotify secret / Soulseek password only if the folder was ever shared.

### I. Docs, instructions & repository hygiene

<a id="doc-06"></a>

#### ❌ DOC-06 — Project rules in `.claude/CLAUDE.md` are git-ignored

**❌❌❌ WON'T DO ❌❌❌** — the owner decided to keep this as is.

**low · docs · verified**

- **Where:** `.gitignore:2` (`.claude/`).
- **What:** `git ls-files .claude` is empty; the 3-line instruction file ("don't git commit/push without explicit request…") exists only on this machine, although it is presented as "checked into the codebase".
- **Fix:** move those rules into the tracked root `CLAUDE.md`, or ignore only `.claude/settings.local.json`.

### J. Product & UX

<a id="prod-01"></a>

#### PROD-01 — Target-design features are still missing (for release scoping)

**medium · product · verified (grep of `src/` against `docs/README-TARGET.md` and `docs/designs/*.png`)**

- **`docs/README-TARGET.md` (and its screenshots) vs the code today** — checked claim by claim:

    | What the target document promises                                                                                                                          | Today                                                                                                                                                                                                       |
    | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | Import from Spotify, YouTube, YouTube Music                                                                                                                | ✅ exists                                                                                                                                                                                                   |
    | Import from **SoundCloud, Deezer, Apple Music, Tidal**                                                                                                     | ❌ no parser for them (URL recognition is purely the registered Spotify/YouTube services); they only appear as _discovered_ links via Songlink                                                              |
    | Settings → Metadata toggles for Spotify, **Deezer, Apple Music, Tidal, YouTube, SoundCloud**, MusicBrainz                                                  | ❌ only Spotify and YouTube (+ Songlink, MusicBrainz, Claude as discovery providers)                                                                                                                        |
    | MusicBrainz options: **import files into Picard on save**, **include MusicBrainz IDs in tags by default**                                                  | ❌ neither (the tag option is hard-coded `false`, see MD-03)                                                                                                                                                |
    | Download settings: yt-dlp + Soulseek, default output folder                                                                                                | ✅ exists                                                                                                                                                                                                   |
    | **Auto-save, auto-delete temp downloads after 24 h, auto-relocate missing files**                                                                          | 🟡 auto-delete exists as an opt-in clean-up of files unused for 48 h (plus a start-up reminder); auto-save and auto-relocate are not implemented (their settings were removed)                              |
    | `Ctrl+S` saves and exits Settings                                                                                                                          | ✅ exists                                                                                                                                                                                                   |
    | Import modal: `Ctrl+V`, list of detected URLs, Enter / Esc                                                                                                 | ✅ exists (plus start options: fetch metadata & download / metadata only / nothing)                                                                                                                         |
    | Metadata screen: TAG? checkbox, fetch primary + discover on other platforms                                                                                | ✅ exists                                                                                                                                                                                                   |
    | Favorite `F`, reject `Del`, reorder `Shift+↑/↓`, editable compiled-metadata row                                                                            | ✅ exists                                                                                                                                                                                                   |
    | Fields: Title, Artists, Duration, Album, Year, Track #, BPM, Key, Genres                                                                                   | ✅ rows exist — but **no provider ever fills BPM, Key or Genres** (always "—"); ISRC is shown too                                                                                                           |
    | Fields: **MusicBrainz IDs** (track, album, artist, album artist, release group) shown in the panel                                                         | ❌ not shown (not in the field list); present in the data model only, and never written to files                                                                                                            |
    | Download screen: DL? checkbox, searches yt-dlp and Soulseek, previews format/size/duration/tags                                                            | ✅ exists (Soulseek needs credentials)                                                                                                                                                                      |
    | Preview with a **waveform** scrubber                                                                                                                       | 🟡 a plain `█░` progress bar with click-to-seek and `Shift+←/→` ±5 s — no waveform                                                                                                                          |
    | `Space` plays a preview                                                                                                                                    | ✅ exists                                                                                                                                                                                                   |
    | `Enter` saves the file                                                                                                                                     | 🟡 saving is `S` on the source row today (Enter selects the source)                                                                                                                                         |
    | Previously saved → "file on disk" state; changed source/metadata → side-by-side diff                                                                       | ✅ exists (recent commits)                                                                                                                                                                                  |
    | `Ctrl+F` relocate; "**Lost the link to the file**" warning                                                                                                 | 🟡 `Ctrl+F` relocate exists (manual path prompt); no code detects a missing file or shows the warning                                                                                                       |
    | `Ctrl+M` **open the file in MusicBrainz Picard**                                                                                                           | ❌ no binding. Only a contextual "Open in MusicBrainz Picard" action exists for a _discovered MusicBrainz recording_ (via Picard's local `127.0.0.1:8000` endpoint) — it opens the recording, not your file |
    | Design screenshots: `[K] Keep & delete other`, `[Ctrl+R] Relaunch downloading`, "Source metadata have changed" banner, "Include MusicBrainz tags" checkbox | ❌ none of them exists                                                                                                                                                                                      |

- **Implemented beyond the design:** sessions, archive, playlist/album import with live refresh, replace-saved-file diff, Songlink/MusicBrainz/Claude discovery, Soulseek provider, mouse support, in-app tour.
- **Decision needed:** which of these are in/out of `v0.2.0`.
- _Update: `docs/README-TARGET.md` was deleted at the owner's request; every promise in the table that is not built yet is now listed in `TODO.md` under "Promised by the former README-TARGET but not built yet". The `docs/designs/*.png` screenshots were kept (`CLAUDE.md` points to them)._

<a id="prod-03"></a>

#### PROD-03 — Every saved track is a FLAC, even when the source is lossy

**medium · product · verified (live run: ffprobe on the saved file)**

- **Where:** `src/flows/musicDownloadFlow/utils/cleanOutputDir.ts:20-21` ("Every saved track is a FLAC; its extension is not up to the user", `OUTPUT_EXTENSION = ".flac"`), yt-dlp invoked with `--audio-format flac`, `utils/metadata.ts` (`cleanAndTagFlac`).
- **What:** a 3-minute YouTube track (Opus, ~128 kbps) became a **37.8 MB / 1759 kbps `.flac`** (13× larger). The UI is honest about it (`FLAC*`, "QUALITY FLAC (transcoded from Opus)"), but the file in the user's library says `.flac`, so players, library scanners and "lossless" filters treat it as lossless. There is no setting to keep the original codec (Opus/M4A/MP3 pass-through) or pick MP3/AAC, which is what most users of a YouTube-sourced downloader would want (and what `preferLossless`/`mp3Fallback` for Soulseek imply).
- **Fix:** let the user choose "keep original / FLAC / MP3 V0 / Opus"; default to the original container for lossy sources and reserve `.flac` for real lossless sources; tag the transcode in a comment field.

<a id="prod-04"></a>

#### PROD-04 — No cover art is ever embedded

**medium · product · verified (live run + grep)**

- **What:** the saved FLAC has `TITLE`, `ARTIST`, `album_artist` and `ENCODER` tags and only one audio stream — no picture. A grep of `src/` for cover/artwork/picture/APIC finds no code that downloads or embeds artwork (Spotify/YouTube Music both provide thumbnails). For a "download and tag" tool, missing artwork is one of the first things users notice in a player; the former `README-TARGET` didn't promise it either, so decide whether it is in scope for 0.2.0.
- **Fix:** download the best thumbnail/album image and embed it (`flac-tagger` supports pictures; `node-id3` supports `image`), with a size cap and a setting to disable.

<a id="prod-05"></a>

#### PROD-05 — First-run friction observed in the live run

**low · ux · verified**

- **What:** (a) the first import is interrupted by **two** back-to-back consent dialogs for optional providers (Songlink, then Claude) while the row only says `Waiting for your an…` (truncated) — a new user has not heard of either; (b) with no Spotify credentials a YouTube import logs `[WARN] Phase A search failed for spotify` in the footer for every task (no explanation; the reason is now logged, DATA-10); (c) with only YouTube + MusicBrainz available, a YouTube-origin track ends up with just title/artist/duration (no album, year, ISRC, cover) and nothing tells the user that Spotify credentials or Songlink would fill them in; (d) completed tasks keep their TAG?/DL? checkboxes ticked, and the next import + Run flipped the already-saved first row from `✅ Saved` back to `⌛ Queued` — confirm whether re-running finished tasks is intended.
- **Fix:** ask the optional-provider questions once, in the welcome tour/first-run, not mid-run; show a one-line "what you get with Spotify credentials" hint; untick finished tasks (or skip them) when running.

### K. Candidates to verify (found while reading, not confirmed)

These come from the UI agent's running notes before it was cut off. Treat them as leads, not findings.

- `useShortcuts` mutates the shortcut registry during render, and `priority`/`exclusive` are captured only at first registration — possible dead shortcuts after remounts.
- `ink-text-input` 6 inserts Ctrl+letter characters while the same key also fires a registered shortcut (e.g. Ctrl+S/R/N/D inside a focused input).
- SGR mouse sequence split across two stdin chunks leaks garbage text to Ink (`index.tsx` regex extraction).
- `useShortcutLiteral` doesn't carry a default `doubleTap` into overrides (hint says `F4` while the entry needs `F4 F4`).
- Light theme: `text.muted #d0d7de` on `#fff` ≈ 1.5:1 contrast; hardcoded `"black"/"white"/"cyan"/"gray"` colors in `UpdateBadge`, `TaskRow`, header, empty state.
- `App.tsx`: per-task `subscribe(...persistCurrent)` fires immediately → O(N²) snapshotting on every task change (matters at hundreds/thousands of tasks).
- Mouse any-event tracking is always on with no setting to disable (native text selection needs Shift-drag).
- `TabBar` spacer `<Text>{"  "}</Text>` (space-indentation rule) without `flexShrink={0}`.

---

## 3. Verified OK (checked, no problem)

- `yarn type-check` passes (3.7 s); `yarn lint` passes with **0 warnings** across all 271 `.ts/.tsx` files (it really covers `.tsx`); `vitest run tests/unit` = 176 passed, 1 skipped, in 2 s.
- Unit tests are properly isolated (`GOBLIN_DATA_DIR` temp dirs), and so are the e2e scenarios, which run on a throwaway copy of their fixture.
- The single `useInput` rule holds (`ShortcutDispatcher` only); virtually all hints go through the registry.
- Shortcut dispatch semantics (priority + `exclusive`) are sound; the duplicate default keys I inspected live in different scopes.
- `settings.json` writes are atomic (temp + rename); `sessions.json` writes are atomic and coalesced, off the main thread.
- A graceful `exitApp()` exists (flush session store + cache, restore terminal, forced exit after 8 s) — crashes and signals now go through `emergencyExit()` (same save + terminal restore).
- The Windows-Terminal-only `screenshot-powershell` step and the headless harness work; the harness is a good base for the regression scenarios proposed above.
- **The happy path works** (given ffmpeg/yt-dlp are present): YouTube Music URL → title/artist/duration → yt-dlp download (~25 MB/s) → `SAVED` with the file at `<out>/<artist> - <title>.flac` and the message `FLAC metadata updated successfully`; Spotify (scrape mode, no credentials) → artist/title + YouTube match; the import options dialog, the Songlink/Claude consent dialogs (declining persists and is logged), quality labelling ("FLAC (transcoded from Opus)"), the output-path preview and the Sessions/Archive/Settings modals all render and respond correctly at 120–160 columns.
- `Tab` behaves as designed (toolbar → task list → lower panel); focus starts on the toolbar.

## 4. Coverage & limits

Eight sub-agents were launched in parallel for: download pipeline, metadata/discovery, core/persistence, UI static review, dynamic TUI exploration, build/release/security, docs/tests, and a live end-to-end pipeline run. **All eight were terminated by an API rate limit (5-hour window, resets 17:40 Paris time) before producing their final reports.** Their saved partial output was used above (`REL-02`, `MD-01/02` experiments, the link check, the UI notes, TUI finding `UI-04`); everything else was done by the orchestrator.

**Not covered or only partially covered** (so the absence of findings there means nothing):

- **The real end-to-end pipeline** was exercised by me only for **one YouTube Music URL** (import → YouTube metadata → MusicBrainz → yt-dlp download → save to FLAC, with the developer's existing ffmpeg/yt-dlp copied into an isolated data dir, so the then-broken ffmpeg bootstrap, since fixed, did not bite) and **one Spotify track in scrape mode** (metadata + YouTube match). Not audited: tag writing in depth (ID3 for non-FLAC, empty-field/erase behaviour, multi-artist handling), the "replace saved file" flow and its diff, file-name sanitising (Windows reserved names, long paths, collisions, cross-drive rename), the overwrite policy, yt-dlp cookies handling, binary integrity (no checksums exist), zip extraction safety, preview playback (mpv) and process cleanup, albums/playlists (collections), non-YouTube/Spotify URLs.
- **Soulseek** (credentials, remote file-name handling, `slsk-client` 1.1.0 vs 2.x), **the Claude provider's process spawn** (shell use, prompt-injection surface, consent flow), Songlink/MusicBrainz rate limiting and User-Agent policy, URL parsing/import fuzzing.
- **UI static review** against `CLAUDE.md` (flexShrink/indentation/`#alias` violations, focus/modal management, accessibility, render performance) beyond the candidates in section K; _runtime_ resize, large sessions (2,000+ tasks), NO_COLOR/non-TTY, idle CPU/memory. (A static terminal-size sweep from 100×30 down to 20×8 was done — see UI-06.)
- **Docs/tests deep review**: claim-by-claim README/CLAUDE.md check, project status table (P1–P29 vs reality), coverage numbers, harness cleanup of orphan processes, `yarn test` full run.
- **Core**: updater edge cases (pre-release tags, installer detection), prototype-pollution in `deepMerge`, two-instance behaviour beyond the pid lock file added for DATA-05.

The sub-agents keep their context: after 17:40 they can be resumed to finish these areas (their scratch work is in `%TEMP%/claude/.../scratchpad/work/<agent>`).

## 5. Side effects of this audit

- While testing the settings row I briefly pointed a _scratch copy's_ persisted `appDataDir` at `%APPDATA%/goblin-malin` (the owner's real installed-app folder). The harness runs then **rewrote `app.log` (truncated by the app at start at the time; now kept as `app.prev.log`, DATA-10) and re-saved `cache/api-cache` there**. `sessions.json`, `settings.json`, `.env`, `install.json` and `bin/` were not touched (their timestamps are unchanged). This was DATA-04 in action (fixed: the data folder is no longer read from `settings.json`).
- Network use: one YouTube Music download (~40 MB) and one Spotify scrape plus a few MusicBrainz lookups (Songlink and Claude were declined; no credentials or cookies were used or copied — only `yt-dlp`, `ffmpeg`, `ffprobe` were copied into an isolated temp data dir).
- My isolated scratch data dirs (`%TEMP%/gm-o`, `gm-live`, `gm-sweep`, with the copied binaries and the 39 MB test download) were deleted afterwards. The remaining scratch files (scripts, scenario JSONs, the sub-agents' partial work) live under `%TEMP%/claude/.../scratchpad`.
