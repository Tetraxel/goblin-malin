# Goblin Malin — pre-release audit for `v0.2.0`

|                      |                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| **Date**             | 2026-11-08                                                                                                |
| **Audited**          | `main` @ `4db1d64` (package version `0.1.15`; npm `latest` is `0.1.14`)                                   |
| **Method**           | Static review + dependency/registry checks + headless TUI scenarios + throw-away repro scripts. Everything marked _verified_ was reproduced or proven from the exact code path. |
| **Auditor**          | Claude (orchestrator) + 8 sub-agents (Sonnet 5.5, max effort). **The sub-agents were cut off by the account's 5-hour rate limit (resets 17:40 Paris time)**, see [Coverage & limits](#coverage--limits). |
| **Status**           | Findings that have been fixed were removed from this file: what is left is open. (Side effects of the audit are listed at the very end.) |

---

## 1. Read this first

The two blockers found here — `yarn build` failing, and a fresh install unable to bootstrap ffmpeg/ffprobe — are **fixed** and gone from this file, like every other finding that was fully fixed (see [Already fixed](#already-fixed)). What `v0.2.0` still needs, in the order I would fix it:

| # | ID | Sev. | One-liner |
|---|----|------|-----------|
| 1 | [DATA-04](#data-04) | high | Data dir is split-brained: `cache/`, `bin/`, `app.log` follow a *persisted* `settings.json` path, not the live data dir |
| 2 | [MD-01](#md-01) | high | Match confidence is blind to every non-ASCII letter: two different Japanese/Russian/Greek songs score as an exact match |
| 3 | [UI-02](#ui-02) | medium | `Ctrl+C` does nothing (verified); there is no documented keyboard way to quit |
| 4 | [DEP-02](#dep-02) | medium | 97 `yarn audit` advisories; the runtime chains (`axios`, `adm-zip`, `ws`) need deliberate bumps |

### Counts

<!-- COUNTS-TABLE -->
| Area | blocker | high | medium | low | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Build, release & packaging (`REL-`) |  |  | 1 | 3 | 4 |
| Dependencies & supply chain (`DEP-`) |  |  | 1 | 1 | 2 |
| Data safety, persistence & state (`DATA-`) |  | 1 | 6 |  | 7 |
| Download pipeline (`DL-`) |  |  |  | 1 | 1 |
| Metadata & discovery (`MD-`) |  | 1 | 2 | 1 | 4 |
| UI / TUI behaviour (`UI-`) |  |  | 2 | 5 | 7 |
| Security (`SEC-`) |  |  |  | 2 | 2 |
| Tests, CI & tooling (`TEST-`) |  |  | 2 | 3 | 5 |
| Docs, instructions & hygiene (`DOC-`) |  |  | 2 | 3 | 5 |
| Product & UX (`PROD-`) |  |  | 3 | 1 | 4 |
| **Total** | **0** | **2** | **19** | **20** | **41** |

Plus 9 unconfirmed candidates in [section K](#k-candidates-to-verify-found-while-reading-not-confirmed) (not counted).
<!-- /COUNTS-TABLE -->

### Already fixed

Removed from this file once fixed and committed (what was found, the fix and how it was checked are in the file's git history: `git log -p -- AUDIT-v0.2.0.md`): **REL-01** (`yarn build`), **REL-04** (`engines`), **REL-05** (`postinstall`), **DEP-01** (unused dependencies), **DATA-01** ("Clear temporary downloads"), **DATA-02** and **DATA-03** (`sessions.json` / `settings.json` validation, quarantine, `.bak`, versioning), **DOC-02** (`.env.example`), **DOC-05** (`TODO.md`), **PROD-02** (dotenv banner), and the ffmpeg/ffprobe bootstrap bug of **DL-01**. Findings that were only partly fixed (**REL-03**, **REL-07**, **DEP-02**, **DOC-04**, **DL-01**) keep just the part that is still open.

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
- **Fix:** bump to `0.2.0` in the release commit and tag `v0.2.0` only after a green dry-run (see REL-03). Also check what the in-app updater does for users whose installed version is higher than the latest release.

<a id="rel-03"></a>
#### REL-03 — The actions in the release workflow are pinned by tag, not by commit SHA
**low · packaging · verified**

- **Where:** `.github/workflows/release.yml`, `.github/workflows/ci.yml`.
- **What:** `actions/*@v4` and `softprops/action-gh-release@v2` are floating tags: whoever controls the tag can change what runs in a job that holds `id-token: write` (npm publish) and `contents: write`. (The rest of this finding — no checks before releasing, publish order, the no-op `--immutable` guard, tag/version mismatch, checkout of the dispatched tag, `npm@latest`, no dry-run — is fixed.)
- **Fix:** pin each action to a full commit SHA (with the tag as a comment) and let Dependabot (`github-actions` ecosystem) bump them.

<a id="rel-06"></a>
#### REL-06 — `prepack`/`postpack` rewrite the README and `git checkout` it afterwards
**medium · packaging · verified by reading**

- **Where:** `package.json` scripts `prepack: node scripts/patch-readme.mjs`, `postpack: git checkout -- README.md`.
- **What:** `npm pack`/`npm publish` rewrite `README.md` in place (relative image paths → `raw.githubusercontent.com/.../main/...`) and `postpack` discards **any uncommitted edit to README.md**. The URLs are pinned to the `main` branch, so a published version's README images change when `main` changes (or break if images move).
- **Fix:** generate the patched README into a temp dir / use `publishConfig`-free approach (absolute image URLs committed in the README), and never run `git checkout` from a package script.

<a id="rel-07"></a>
#### REL-07 — Packaging leftovers: the `pkg` patch script, undeclared imports in `scripts/`, `emitDecoratorMetadata`
**low · maintainability · verified**

- **Where:** `scripts/patch-pkg-compat.mjs` (12 KB, patches `node_modules` for the abandoned `pkg` packaging; still runs at dev install), `scripts/build-sea.mjs` (imports undeclared `esbuild`; other `scripts/` import `react-reconciler`/`yoga-layout` without declaring them), `tsconfig.json` (`emitDecoratorMetadata`).
- **What:** the exe is built with Node SEA (`build-sea.mjs`). The compat patch may still be what lets the esbuild SEA bundle resolve `flac-tagger` (`exports` without `require`), so don't delete it blindly — re-document what it is for. `@swc/core` is **not** dead: tsup loads it automatically because `emitDecoratorMetadata` is on, and that swc path is what made the former build break (a stray non-UTF-8 byte, a type-only import kept alive as a value import) invisible to `tsc`/`eslint`/`tsx`.
- **Fix:** keep/rename the patch only if the SEA build needs it; declare `esbuild`, `react-reconciler`/`yoga-layout` if scripts import them; drop `emitDecoratorMetadata` (nothing reads `design:*` metadata; `Cached` is a plain method decorator), which removes the swc path; add a UTF-8 check in CI and the `@typescript-eslint/consistent-type-imports` lint rule so the same failure class can't come back.

### B. Dependencies & supply chain

<a id="dep-02"></a>
#### DEP-02 — `yarn audit`: 97 advisories (0 critical, 57 high, 37 moderate, 3 low); reachable runtime chains
**medium · security · verified (audit run today)**

| Chain (root dependency) | Advisories | Runtime? | Comment / fix |
| --- | --- | --- | --- |
| `typescript-eslint` → minimatch/brace-expansion | 28 | dev only | bump (`8.72.x`) |
| `ytmusic-api` → `axios` 1.16.0 → follow-redirects/form-data | 24 | **runtime** | patched axios is `≥1.18/1.20`; `ytmusic-api 5.3.1` is the latest release (Feb 2026) → add a `resolutions` entry for `axios`; exploitability is low (fixed YouTube Music URLs) |
| `eslint` → js-yaml | 16 | dev only | bump |
| `vitest` → vite/postcss/nanoid | 13 | dev only | bump to a patched 4.x/5.x |
| `adm-zip` 0.5.17 | 8 | **runtime** | used to unzip the downloaded ffmpeg/ffprobe; fixed only in `0.6.x` (outside `^0.5.17`) → deliberate bump + check `extractEntryTo` use in `ffmpeg-setup.ts`/`ffprobe-setup.ts`; archives come from fixed vendor URLs, so risk is moderate, but there is no integrity check (see DL-01) |
| `eslint-plugin-react-hooks` → babel/browserslist/zod | 5 | dev only | bump |
| `ink` → `ws` 8.20.0 | 2 | **runtime** | patched `ws ≥ 8.21` → `ink` 7.1.x or a `resolutions` pin |
| `tsup` | 1 | dev only | bump |

<a id="dep-03"></a>
#### DEP-03 — Outdated dependencies
**low · deps · verified (`yarn outdated`)**

`ink` 7.0.2 → 7.1.1 (8.0.0 latest) · `react` 19.2.6 → 19.3.1 · `ytdlp-nodejs` 3.4.4 → 3.4.5 · `slsk-client` 1.1.0 → 2.0.2 (major; unmaintained-looking, see Soulseek note in Coverage) · `musicbrainz-api` 1.2.1 → 2.0.1 · `typescript` 6.0.3 → 7.0.2 · `vitest` 4.1.9 → 5.1.0 · `@types/node` 25 → 26 · `eslint` 9 → 10, `prettier`, `tsx`, `typescript-eslint`, `playwright` minor bumps. Do the minor/patch bumps with the build and tests green; defer majors.

### C. Data safety, persistence & state

<a id="data-04"></a>
#### DATA-04 — The data directory is split-brained between the live value and a persisted setting
**high · bug / isolation · verified (code + observed live, and it bit the audit itself)**

- **Where:** `src/constants.ts:25-26` (`DEFAULT_APP_DATA_DIR` = `GOBLIN_DATA_DIR`, else dev `<repo>/data`, else the OS default) · `src/utils/appPaths.ts:16-28` (`getCacheDir/getBinDir/getLogsPath` read `SettingsStore…general.appDataDir`) · `src/settings/appSettings.ts:40`, `src/settings/buildGlobalSettingsItems.ts:59` · `src/utils/cache.ts:20` (reads it at import time) · tracked fixtures `scripts/tui-test/fixtures/*/settings.json` (contain an absolute `C:\Users\axel7\…` path).
- **What:** `sessions.json`, `settings.json`, `.env`, `install.json` live under `DEFAULT_APP_DATA_DIR`. `cache/` (api-cache, songlink_rate.json), `bin/` (yt-dlp, ffmpeg, ffprobe, mpv, cookies.txt) and `app.log` are derived from `general.appDataDir` in `settings.json` — a value that defaults to the same path but is written into the file on the first save and then wins forever. If the folder is moved, restored from a backup, synced between machines/users, or `GOBLIN_DATA_DIR` changes, the tools/cache/log keep pointing at the old absolute path: ~460 MB of binaries are re-downloaded into a stale location, or the app writes into another user's profile/an unplugged drive. It also means v0.2.0 cannot relocate `bin/`/`cache/` for anyone who has saved settings.
- **Evidence:** with `GOBLIN_DATA_DIR` pointing at a copy of a fixture, the Settings row still displayed the fixture's path. The audit itself tripped on it: a scratch copy whose stored `appDataDir` I set to `%APPDATA%/goblin-malin` made the harness write `app.log` and `cache/api-cache` into the developer's **real** installed-app folder (see "Side effects" at the end). Harness runs on fixture *copies* also write cache/log/binaries into the repo's fixture folders.
- **Fix:** never persist `appDataDir` (derive it from `DEFAULT_APP_DATA_DIR` everywhere; keep the Settings row informational) and strip the stored key on load; make fixtures path-independent.

<a id="data-05"></a>
#### DATA-05 — Persistence failures are invisible; closing can hang 8 s and then drop data; two instances overwrite each other
**medium · data-loss · verified by reading**

- **Where:** `src/sessions/sessionStore.ts:60-70` (`catch { this.dirty = true }`) and `flush()` (`while (this.dirty || this.writing) await sleep(5)`), `src/utils/exitApp.ts` (`MAX_CLOSE_MS = 8000`), fixed temp name `sessions.json.tmp`.
- **What:** a failing write (disk full, file locked by antivirus/OneDrive, permissions) is swallowed — no log, no message. `flush()` never retries after a failure, so at exit it waits until `exitApp`'s 8 s timeout force-quits and the user is told "Everything is saved" (`shutdownState.setDone`) path is skipped but the data is not saved. Two app instances on the same data dir (second terminal tab) each hold the full file in memory and rewrite the **whole** file on every change with the same `.tmp` name: last writer wins, the other instance's work is lost silently; there is no lock file.
- **Fix:** log + surface write failures (status line), retry with backoff in `flush()`, unique temp names, a simple lock file (or refuse a second instance with a message).

<a id="data-06"></a>
#### DATA-06 — The self-update path exits with `process.exit(0)`, bypassing the graceful shutdown
**medium · bug · verified by reading**

- **Where:** `src/components/UpdateModal/UpdateModal.tsx:69` vs `src/utils/exitApp.ts`.
- **What:** after a successful `npm install -g …`, Enter calls `process.exit(0)` directly: no `SessionStore.flush()`, no cache save, alt-screen/mouse mode restored only partially (`process.once("exit")` in `index.tsx` writes `DISABLE_MOUSE` but not the alt-screen-leave sequence). Debounced session edits made just before are lost and the terminal stays on the alternate screen.
- **Fix:** call `exitApp()`.

<a id="data-07"></a>
#### DATA-07 — No `uncaughtException`/signal handling; the terminal is left in alt-screen/mouse mode
**medium · bug · verified by reading**

- **Where:** `src/index.tsx` (only `unhandledRejection` is handled; no `uncaughtException`, `SIGINT/SIGTERM/SIGHUP`).
- **What:** a crash, `kill`, or closing the terminal window skips `exitApp()`: pending debounced session writes are lost and, after a crash, the shell is left on the alternate screen with mouse reporting on (clicks print escape codes). `start()` also monkey-patches global `console.log/error/warn`, an unexpected side effect for a public library entry (`GoblinMalin.start()`).
- **Fix:** a single `process.on("uncaughtException" | "SIGTERM" | "SIGHUP")` handler that runs the same cleanup as `exitApp` (flush + restore terminal), and keep the console patch inside the app entry only.

<a id="data-08"></a>
#### DATA-08 — The temp folder lives inside the Music library and nothing cleans it; several settings are dead
**medium · product · verified by reading**

- **Where:** `src/flows/musicDownloadFlow/settings.ts:50-84`, `src/flows/musicDownloadFlow/buildFlowSettingsItems.ts:199-218` (UI commented out).
- **What:** every candidate source is downloaded in full to `~/Music/GoblinMalin/tmp` (yt-dlp and Soulseek) and only the selected one is later saved to the output dir; unselected candidates and retries stay forever. `autoDeleteTempAfter24h`, `autoSaveToOutputDir`, `autoRelocateMissingFiles` and both `autoChooseBestSource` flags exist in the settings schema (and the former `README-TARGET` promised them) but their UI is commented out and **no code reads them** (only `preferLossless` is used). Music players/scanners watching `~/Music` (Windows Media, iTunes, Plex, Navidrome) will index those unselected candidates as duplicates.
- **Evidence (live run):** after saving a track the 39.6 MB candidate `YtDlp YOUTUBE-TRACK-dlR8aLEeAr8 <uuid>.flac` was still in the temp folder next to the 37.8 MB saved copy — every saved track costs its size twice until someone clicks "Clear temporary downloads".
- **Fix:** default the temp dir to the OS cache dir, implement the 24 h cleanup or delete the dead settings, delete a task's unselected candidates once a file is saved.

<a id="data-09"></a>
#### DATA-09 — About 460 MB of tool binaries live under `%APPDATA%` (Roaming)
**medium · product · verified for sizes; the Roaming consequence is likely**

- **Where:** `src/constants.ts:12-19`, `src/utils/{ffmpeg,ffprobe,mpv}-setup.ts`, `…/ytdlp-setup.ts`.
- **What:** `data/bin` on the dev machine: `ffmpeg` 163 MB + `ffprobe` 163 MB (the full GPL build ships both at full size) + `mpv` 113 MB + `yt-dlp` 23 MB, with date-stamped file names. On roaming-profile / OneDrive-redirected setups ~0.5 GB of executables gets synced; `%LOCALAPPDATA%` is the right place for binaries and caches. (The real installed-app folder `%APPDATA%/goblin-malin/bin` already holds 270 MB.)
- **Fix:** `%LOCALAPPDATA%` / `~/Library/Caches` / `$XDG_CACHE_HOME` for `bin/` and `cache/`; consider an audio-only ffmpeg build or the system ffmpeg; document the footprint.

<a id="data-10"></a>
#### DATA-10 — Logging is heavy and not useful: whole tasks in every record, `Error`s serialize to `{}`, file truncated at start
**medium · performance/observability · verified (live run + code)**

- **Where:** `src/base/logger/logger.ts:12` (`fs.writeFileSync(logsPath, "")`), `:43` (winston `format.json()`), `:62-68` (every record gets `task`); 49 call sites of the form `logger.warn|error("…", { error })` (e.g. `env.ts`, the `unhandledRejection` handler).
- **What:** (a) every log record produced inside a task embeds the **entire `Task` object** (`_snapshotCache`, `attributes`, `activeAbortBySourceIndex`, …): 17 of the first 21 lines of a one-track run, ≈ 2.1 KB per line on average (max 4.3 KB) for a task that has only just started. A finished task is 3–30 KB (median 3.3 KB, p90 5 KB, max 30 KB across the 130 tasks of the developer's real `sessions.json`), and the file transport always keeps DEBUG, so a 100-track batch with ~100 lines per track is tens of MB per run — all stringified synchronously on the UI thread. (b) `JSON.stringify(new Error("x"))` is `{}`: the one `warn` of the live run reads `{"details":{"error":{}}, "message":"Phase A search failed for spotify"}` — the reason is lost (the same message also pops up in the footer for any user without Spotify credentials). (c) `app.log` is truncated at every start, so the previous session's log — the one you want after a crash — is erased the moment the app restarts (a harness run truncated the developer's real `%APPDATA%/goblin-malin/app.log`).
- **Fix:** log a task *reference* (`taskId`, URL) instead of the object; add an error serializer (`format.errors({ stack: true })` plus a replacer that maps `Error` → `{ name, message, stack }`); rotate (`app.log` → `app.log.1`) instead of truncating; cap the file size.

### D. Download pipeline

<a id="dl-01"></a>
#### DL-01 — Tool downloads: no integrity check, duplicated helpers, one archive fetched twice
**low · hardening · follow-ups to the (fixed) ffmpeg/ffprobe bootstrap bug**

- **What is still open:** (1) the downloaded binaries (ffmpeg, ffprobe, yt-dlp, mpv) are not SHA256-verified; (2) `src/utils/mpv-setup.ts` still carries its own copies of the old `httpsGetJson`/download helpers (no status check, no timeout) instead of `src/utils/http.ts` — mpv is optional and falls back to a `PATH` copy on purpose, so it raises no alert; (3) on a first run ffmpeg and ffprobe each download the same ~200 MB archive.
- **Fix:** verify checksums where the vendor publishes them, move `mpv-setup.ts` onto `#utils/http`, and have ffmpeg and ffprobe share one download (extract both binaries from the same archive).

### E. Metadata & discovery

<a id="md-01"></a>
#### MD-01 — The confidence score is blind to every non-ASCII letter
**high · bug · verified (root cause by reading + the metadata agent's score experiments)**

- **Where:** `src/flows/musicDownloadFlow/utils/confidence.ts:3-8` (`normalize`: `.toLowerCase().trim().replace(/[^\w\s]/g, "")`).
- **What:** in JavaScript `\w` is ASCII-only, so this strips every Cyrillic, Greek, Arabic, CJK, Hangul… letter **and** every accented Latin letter (`Beyoncé` → `beyonc`). A title or artist written in a non-Latin script normalizes to an empty/blank string, and two blank strings compare as an *exact* match. Measured scores (0–100): Cyrillic **different titles and different artists** with the same duration = **60**, the same as identical Cyrillic titles (60); Japanese *identical* track = 20 but a **different** Japanese track by a different artist = 20; Korean exact + year = 30; Greek identical = 60; accents only differing = 85. The discovery code uses the score to rank, to auto-pick, and (for the Claude last-resort provider) to accept results at `LAST_RESORT_MIN_CONFIDENCE = 50`: a *different* Cyrillic song passes (60 ≥ 50) while a correct Japanese match (20) is rejected.
- **Other observations from the same experiments:** same title + same duration by a *different artist* (cover/karaoke) scores 60 and passes the last-resort threshold; a *live* version with the same duration scores 85 and a remaster 75; "Love" vs "Love Me Do" (substring) 55 — the title/artist/duration formula cannot discriminate versions.
- **Impact:** wrong silent matches for any non-Latin catalogue, no matches for others; accent handling is only accidentally consistent.
- **Fix:** normalize with `s.normalize("NFKD").replace(/\p{M}/gu, "")` and keep `\p{L}\p{N}` (`/[^\p{L}\p{N}\s]/gu`); treat empty-after-normalization as "no information" (0 points), not as equal; add version-marker penalties (live/remix/karaoke/cover) and unit tests with the cases above.

<a id="md-02"></a>
#### MD-02 — Degraded and negative results are cached for 90 days; scraped Spotify data has no ISRC
**medium · bug · reported (reproduced by the metadata agent's script; output kept)**

- **Where:** `src/utils/cache.ts` (`@Cached`, `ttl` 90 days, caches `null`/`""` and "not found" objects), `SpotifyService.getTrackMetadata` (`@Cached()`), `MusicBrainzDiscoveryService.discoverFromUri`, `SonglinkService.discoverFromUri`.
- **What:** (a) when the official Spotify API fails and the scrape fallback answers, the scraped result is cached under the **same key** as an official one; after the user fixes the credentials the same URL keeps returning the scraped data (`isrc: undefined`) for 90 days ("cached fallback served"). (b) "notFound" anchors and empty lists are cached 90 days (only the Claude provider uses a short TTL — the author's own comment says "a 'nothing found' shouldn't stick for months"): MusicBrainz data added tomorrow, or a transient error mapped to "notFound", sticks. (c) Concurrent cold calls are not de-duplicated (3 calls → 3 network requests). (d) Scrape mode yields no ISRC, so ISRC-exact matching is impossible and discovery falls back to fuzzy name matching (see MD-01).
- **Fix:** include the auth mode/provenance in the cache key or don't cache fallbacks; short TTL (e.g. 1 day) or no caching for negative results; in-flight de-dupe (`Map<key, Promise>`); say in the UI/README what scrape mode loses.

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

<a id="ui-01"></a>
#### UI-01 — The URL-paste shortcut hijacks text pasted into any text field (and stacks a second modal)
**medium · bug · verified (TUI harness)**

- **Where:** `src/components/ShortcutDispatcher.tsx:19-40`; Ink 7 already ships `usePaste` (bracketed paste, `node_modules/ink/build/hooks/use-paste.js`) which the app does not use.
- **What:** any stdin chunk longer than 8 chars containing `http(s)://` is treated as an import paste "before normal shortcut routing so they work even inside modals". Pasting a URL into the Archive search box (or the Sessions search/rename, Settings search, a text setting) therefore (1) still inserts the URL into the field *and* (2) opens the Import modal, which is painted **under** the Archive modal so its actions are partly hidden. Non-URL or scheme-less pastes (`open.spotify.com/…`, `spotify:track:…`) are ignored.
- **Evidence:** harness scenario: open Archive, `type` `https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC` → the search field shows `⌕ hellohttps://open.spotify.com/track/…` **and** `Import 1 URL … [Spotify] https://open.spotify.com/track/…` is on screen behind the Archive frame.
- **Fix:** use `usePaste` in one place; deliver the paste to the focused text input when one has focus and open Import only when no field/modal owns input; accept scheme-less links and `spotify:` URIs.

<a id="ui-02"></a>
#### UI-02 — `Ctrl+C` does nothing and there is no documented keyboard way to quit
**medium · ux · verified (harness: two Ctrl+C presses, app still running)**

- **Where:** `src/index.tsx` (`exitOnCtrlC: false`, no replacement handler); README does not say how to exit.
- **What:** the only exits are the toolbar "Exit" button (reached with double-Esc, then arrows, then Enter) or mouse. In a terminal app users expect Ctrl+C (or `q`/Ctrl+Q) to quit; `Ctrl+C` is instead bound to "Copy" in two panels.
- **Fix:** register a rebindable `global.quit` shortcut (e.g. `Ctrl+Q`) and make a double `Ctrl+C` call `exitApp()`; document it in the README and the in-app hints.

<a id="ui-03"></a>
#### UI-03 — Import reads the clipboard with blocking `execSync`; Linux support limited to `xclip`
**low · performance/ux · verified (timed)**

- **Where:** `src/components/ImportModal/clipboard.ts:7-19`.
- **What:** `readClipboard()` is `async` but runs `execSync('powershell -command "Get-Clipboard"')` (Windows; 224–258 ms measured here, more on a cold start/AV), `pbpaste`, or `xclip -selection clipboard -o` — synchronous, so the whole TUI freezes meanwhile. On Linux without `xclip` (Wayland: `wl-paste`; or `xsel`) it silently returns `""` and Ctrl+V looks dead. `clipboardy` (already a dependency, imported in 4 other places) does async reads with fallbacks.
- **Fix:** `await clipboardy.read()` with a visible message when empty/unavailable.

<a id="ui-04"></a>
#### UI-04 — The read-only "App directory" row garbles label and value when the row is narrow
**low · ux (layout) · verified (harness at 140/120/100/80 columns; also found independently by the TUI agent)**

- **Where:** `src/components/SettingsModal/SettingsItemRow.tsx:133-141` (`case "readonlyText"`), `src/settings/buildGlobalSettingsItems.ts:59`.
- **What:** the row is four sibling `<Text>` nodes (label, `(read-only)`, `:`, value), none with `flexShrink={0}` (the CLAUDE.md "Box shrinking" gotcha). When label + value exceed the width, Yoga shrinks all four and words interleave: at the classic **80×30** terminal with a normal path (`C:/Users/<name>/AppData/Roaming/goblin-malin`, 43 chars): `│    🗁  App         (read-only: C:/Users/axel7/AppData/Roaming/goblin-m  │` / `│  directory                    alin  │`. Fine at 100+ columns with a short path; broken at any width with a long (e.g. dev-checkout) path.
- **Fix:** `<Box flexShrink={0}>` around the label/marker, `wrap="truncate-middle"` on the value.

<a id="ui-05"></a>
#### UI-05 — A hardcoded key label in the empty state violates the "live hints" rule
**low · maintainability · verified**

- **Where:** `src/components/TaskListPanel/TaskListPanel.tsx:372` (`Press Ctrl+V to import music URLs`); `src/components/WelcomeModal/intro/tour.ts` mentions key names twice.
- **What:** `global.import` is user-rebindable, but the empty-state text always says Ctrl+V (`CLAUDE.md`: "Never hardcode a key label that maps to a registered shortcut"). Everything else I grepped follows the rule.
- **Fix:** `<Hint label="import music URLs" shortcutId="global.import" />`; check the tour strings the same way.

<a id="ui-06"></a>
#### UI-06 — The main layout needs ~66 columns; below that the toolbar scrolls off and columns jam together
**low · ux (layout) · verified (harness sweep on a copy of the 50-task fixture)**

- **What:** sizes tested: 100×30, 80×24, 76/72/68×24 are fine; at **64×24** and **60×20** rows are wider than the terminal, wrap (`No s` / `ta…`) and push the toolbar/header out of the screen (the top of the snapshot is a task row); at 50×16, 40×12 the columns collapse (`4v…wg…✓ 0No sta…`); 30×10 and 20×8 are unreadable. No crash, no exception at any size (`exitCode` stays `null`, no stack text), but also no "terminal too small" message or minimum-size guard (the Settings modal degrades more gracefully than the main screen).
- **Impact:** split panes (tmux, Windows Terminal) narrower than ~66 columns show a broken screen with no hint why.
- **Fix:** below a minimum (e.g. 66×16) render a single line "Terminal too small — need at least 66×16 (now W×H)"; hide low-priority columns (SPOTIFY/YOUTUBE/MB) progressively; see the `flexShrink` guidance in `CLAUDE.md`.

<a id="ui-07"></a>
#### UI-07 — After deleting/archiving the last task the selection index is stale
**low · bug · verified (harness)**

- **Where:** task selection state in `src/hooks/useFocusManager.ts` (`selectedTaskIndex` is not clamped when the list shrinks).
- **What:** with the 50-task fixture: select the last row (`Task 50/50`), press `Del` → "Archive / Delete / Cancel" → Enter. Afterwards **no row shows the cursor**, the action bar says `No contextual actions available`, the compiled-metadata panel is empty and `ArrowDown` does nothing; the first `ArrowUp` recovers (`Task 49/49`). (The UI agent's note also suspected phantom entries in `selectedTaskIds` after removals — not verified.)
- **Fix:** clamp `selectedTaskIndex` (and prune `selectedTaskIds`) whenever `tasks.length` changes; add a unit test for `buildVisibleTaskOrder`/selection.

### G. Security

<a id="sec-01"></a>
#### SEC-01 — URLs are interpolated into shell strings
**low · security · verified by reading**

- **Where:** `src/utils/openUrl.ts` (`exec(\`start "" "${url}"\`)` / `open "${url}"` / `xdg-open "${url}"`), `src/components/UpdateModal/UpdateModal.tsx:49-56` (same pattern with `releaseUrl` from the GitHub API), update command run via `spawn(cmd, { shell: true })`.
- **What:** a `"` inside the URL breaks out of the quoting (and `%VAR%` expands inside cmd quotes). Current call sites pass constants / the GitHub API's `html_url`, so it is not exploitable today, but the helper is a footgun; the `open` package (already a dependency, used elsewhere) uses `spawn` without a shell.
- **Fix:** use `open` everywhere (drop `openUrl.ts` and the inline `exec`), keep `spawn(bin, args)` without `shell: true` for the updater.

<a id="sec-02"></a>
#### SEC-02 — A copy of the secrets file sits in the repository root (kept on purpose)
**low · security · verified (key names only inspected — values never read)**

- **Where:** `(copie).env` (repo root; matches `*.env` in `.gitignore`, not in npm `files`).
- **What:** it holds `SOULSEEK_USERNAME`, `SOULSEEK_PASSWORD`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` in plaintext, next to the source. The owner wants to keep it, which is fine: it is safe from git and npm as long as the `*.env` pattern in `.gitignore` and the `files` whitelist in `package.json` stay as they are. The folder lives under `Documents` (a `.tmp.driveupload` folder suggests a sync client), so the secrets may be uploaded by that client.
- **Fix (optional):** nothing required. If you want a little more safety, keep such copies outside the repository folder (or outside synced folders), and rotate the Spotify secret / Soulseek password only if the folder was ever shared.

### H. Tests, CI & tooling

<a id="test-01"></a>
#### TEST-01 — `tests/` and `scripts/` are never type-checked or linted; `format:check` fails on 74 files
**medium · tests · verified**

- **Where:** `tsconfig.json` (`include: ["src/**/*"]`), `package.json` (`lint: eslint src/`), `eslint.config.js` (ignores `scripts/`), `.prettierrc.json`.
- **What:** type errors/lint issues in the 21 unit tests, 3 e2e tests and the whole TUI harness are invisible to the standard commands; `yarn format:check` fails on 74 of 271 `src` files (4-space `.prettierrc` vs files formatted with 2).
- **Fix:** add a `tsconfig.test.json` (`tests`, `scripts`) to `type-check`, lint `tests/`, run `prettier --write` once and enforce it in CI.

<a id="test-02"></a>
#### TEST-02 — The e2e smoke test runs against the developer's real data dir; fixtures are not hermetic
**medium · tests · verified**

- **Where:** `tests/e2e/smoke.test.ts` (no `dataDir`), `tests/e2e/perf.test.ts` (uses a tracked fixture dir directly), fixtures' absolute `appDataDir` (DATA-04).
- **What:** `yarn test` boots the real app on `<repo>/data` (the developer's sessions, settings and cache) and on tracked fixtures that the app rewrites; in CI the real data dir doesn't exist and fixtures contain a Windows path.
- **Fix:** have the harness always copy the fixture into a temp dir and rewrite `appDataDir`/output dirs; set `GOBLIN_DATA_DIR` for every e2e test.

<a id="test-03"></a>
#### TEST-03 — A stale example scenario passes for the wrong reason
**low · tests · verified**

- **Where:** `scripts/tui-test/examples/navigate-settings.json`.
- **What:** it presses → twice then Enter expecting Settings; since the "Archive" toolbar button was added the same keys open the **Archive** modal (snapshot `settings-open` shows `▤ ARCHIVE`), yet `assert contains "Settings"` passes because "Settings" is a permanent toolbar label.
- **Fix:** press → three times and assert on modal-specific text (`Search settings…`).

<a id="test-04"></a>
#### TEST-04 — The harness emulator mis-measures emoji, adding a spurious `││`
**low · tests · reported (TUI agent)**

- **What:** `@xterm/headless` uses its default Unicode-6 width table, so emoji (😉, 🏆) are 1 cell wide in snapshots while the app (via `string-width`) assumes 2; rows containing an emoji show an extra `│` at the right edge. Looks like an app layout bug, isn't.
- **Fix:** load `@xterm/addon-unicode11` in `scripts/tui-test/termEmulator.ts`.

<a id="test-05"></a>
#### TEST-05 — Test coverage misses the places where this audit found the data-loss bugs
**low · tests · verified (import map of `tests/`)**

- **What:** 26 unit files / 220 tests. No tests for `settingsStore` edge cases, `sessionStore` load/corruption, the shortcut registry dispatch, the updater (`isNewer`, installer detection), `envFile`, or any UI hook/component beyond the windowing helpers and `useConfirmModal`. `downloadTask.ts` is exercised indirectly by 7 tests.
- **Fix:** the repro tables of DATA-02/03 are now regression tests (`tests/unit/sessionStore.test.ts`, `settingsStore.test.ts`); still missing: the shortcut registry, updater, `envFile`, hooks; add a coverage report (`@vitest/coverage-v8`) to CI.

### I. Docs, instructions & repository hygiene

<a id="doc-01"></a>
#### DOC-01 — `docs/audit/*` is stale, and `CLAUDE.md` tells agents to read it first
**medium · docs · verified**

- **Where:** `docs/audit/*.md` (last touched 2026-04-21), `CLAUDE.md` ("Read this before exploring the codebase").
- **What:** the audit describes `FlowBase`, `FlowOrchestrator`, `musicDownloadFlow.ts`, `FlowSelector.tsx`, the `inputs.txt` import — all removed by P20b — and says MusicBrainz, Song.link and Soulseek are disabled/unregistered (they are active). Every Claude/agent session is pointed at it.
- **Fix:** delete or regenerate it (the project tree in `scripts/TREE.ps1` + a short architecture note); update the `CLAUDE.md` pointer.

<a id="doc-03"></a>
#### DOC-03 — The README is missing what a v0.2.0 user needs
**medium · docs · verified**

- **What:** the macOS section is not in the table of contents; the feature list mentions only Spotify/YouTube + yt-dlp (not Soulseek, MusicBrainz, Songlink, Claude, playlist/album import, sessions, archive, mouse, replace-saved-file); no keyboard-shortcut table and no "how to quit" (UI-02); no data/log locations per OS, no `GOBLIN_DATA_DIR`; no privacy notes (update check calls `api.github.com`; Songlink/Claude send data to third parties after consent); no troubleshooting (cookies, ffmpeg, mpv); screenshots are from May.
- **Fix:** add these sections; also check `yarn global add` (not available on Yarn ≥2).

<a id="doc-04"></a>
#### DOC-04 — `docs/projects/` link to source files that were removed
**low · docs · verified (link checker over all 49 markdown files)**

- `docs/projects/p20`, `p20b` and `p22` link to `src/base/flow/*`, `FlowSelector.tsx` and `musicDownloadFlow.ts` (removed).
- **Fix:** keep the historical docs but mark them as superseded (or drop the dead links).

<a id="doc-06"></a>
#### DOC-06 — Project rules in `.claude/CLAUDE.md` are git-ignored
**low · docs · verified**

- **Where:** `.gitignore:2` (`.claude/`).
- **What:** `git ls-files .claude` is empty; the 3-line instruction file ("don't git commit/push without explicit request…") exists only on this machine, although it is presented as "checked into the codebase".
- **Fix:** move those rules into the tracked root `CLAUDE.md`, or ignore only `.claude/settings.local.json`.

<a id="doc-07"></a>
#### DOC-07 — Repo-root clutter and no changelog
**low · hygiene · verified**

- **What:** `(copie).env` (kept on purpose, see SEC-02), `app.log`, `test-tui-pretty.log`, `.tmp.driveupload/`, and untracked `MusicBrainzCell.tsx.txt`, `inputs.txt`, `urls.txt`, `sfx.md`, `icon.png` (some are the owner's local notes). `src/assets/sounds/intro` holds 59 sample files that the owner's notes describe as Splice samples copied unchanged — **check Splice's licence before redistributing them in a public npm package/repo**. No `CHANGELOG`, `.gitattributes` (line endings matter: the release runs on Windows and the bin file needs an LF shebang), `.nvmrc` or `SECURITY.md`; `package.json` lacks `homepage`/`bugs`; `"license": "SEE LICENSE IN LICENSE"` (custom licence) deserves a README note.
- **Fix:** clean up/ignore, add a `CHANGELOG.md` for 0.2.0 (31+ commits since 0.1.15), `.gitattributes` (`* text=auto eol=lf`), and a licence decision for the audio samples.

### J. Product & UX

<a id="prod-01"></a>
#### PROD-01 — Target-design features are still missing (for release scoping)
**medium · product · verified (grep of `src/` against `docs/README-TARGET.md` and `docs/designs/*.png`)**

- **`docs/README-TARGET.md` (and its screenshots) vs the code today** — checked claim by claim:

  | What the target document promises | Today |
  | --- | --- |
  | Import from Spotify, YouTube, YouTube Music | ✅ exists |
  | Import from **SoundCloud, Deezer, Apple Music, Tidal** | ❌ no parser for them (URL recognition is purely the registered Spotify/YouTube services); they only appear as *discovered* links via Songlink |
  | Settings → Metadata toggles for Spotify, **Deezer, Apple Music, Tidal, YouTube, SoundCloud**, MusicBrainz | ❌ only Spotify and YouTube (+ Songlink, MusicBrainz, Claude as discovery providers) |
  | MusicBrainz options: **import files into Picard on save**, **include MusicBrainz IDs in tags by default** | ❌ neither (the tag option is hard-coded `false`, see MD-03) |
  | Download settings: yt-dlp + Soulseek, default output folder | ✅ exists |
  | **Auto-save, auto-delete temp downloads after 24 h, auto-relocate missing files** | ❌ schema keys only; UI commented out, no code reads them (DATA-08) |
  | `Ctrl+S` saves and exits Settings | ✅ exists |
  | Import modal: `Ctrl+V`, list of detected URLs, Enter / Esc | ✅ exists (plus start options: fetch metadata & download / metadata only / nothing) |
  | Metadata screen: TAG? checkbox, fetch primary + discover on other platforms | ✅ exists |
  | Favorite `F`, reject `Del`, reorder `Shift+↑/↓`, editable compiled-metadata row | ✅ exists |
  | Fields: Title, Artists, Duration, Album, Year, Track #, BPM, Key, Genres | ✅ rows exist — but **no provider ever fills BPM, Key or Genres** (always "—"); ISRC is shown too |
  | Fields: **MusicBrainz IDs** (track, album, artist, album artist, release group) shown in the panel | ❌ not shown (not in the field list); present in the data model only, and never written to files |
  | Download screen: DL? checkbox, searches yt-dlp and Soulseek, previews format/size/duration/tags | ✅ exists (Soulseek needs credentials) |
  | Preview with a **waveform** scrubber | 🟡 a plain `█░` progress bar with click-to-seek and `Shift+←/→` ±5 s — no waveform |
  | `Space` plays a preview | ✅ exists |
  | `Enter` saves the file | 🟡 saving is `S` on the source row today (Enter selects the source) |
  | Previously saved → "file on disk" state; changed source/metadata → side-by-side diff | ✅ exists (recent commits) |
  | `Ctrl+F` relocate; "**Lost the link to the file**" warning | 🟡 `Ctrl+F` relocate exists (manual path prompt); no code detects a missing file or shows the warning |
  | `Ctrl+M` **open the file in MusicBrainz Picard** | ❌ no binding. Only a contextual "Open in MusicBrainz Picard" action exists for a *discovered MusicBrainz recording* (via Picard's local `127.0.0.1:8000` endpoint) — it opens the recording, not your file |
  | Design screenshots: `[K] Keep & delete other`, `[Ctrl+R] Relaunch downloading`, "Source metadata have changed" banner, "Include MusicBrainz tags" checkbox | ❌ none of them exists |

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

- **What:** (a) the first import is interrupted by **two** back-to-back consent dialogs for optional providers (Songlink, then Claude) while the row only says `Waiting for your an…` (truncated) — a new user has not heard of either; (b) with no Spotify credentials a YouTube import logs `[WARN] Phase A search failed for spotify` in the footer for every task (no explanation, see DATA-10); (c) with only YouTube + MusicBrainz available, a YouTube-origin track ends up with just title/artist/duration (no album, year, ISRC, cover) and nothing tells the user that Spotify credentials or Songlink would fill them in; (d) completed tasks keep their TAG?/DL? checkboxes ticked, and the next import + Run flipped the already-saved first row from `✅ Saved` back to `⌛ Queued` — confirm whether re-running finished tasks is intended.
- **Fix:** ask the optional-provider questions once, in the welcome tour/first-run, not mid-run; show a one-line "what you get with Spotify credentials" hint; untick finished tasks (or skip them) when running.

### K. Candidates to verify (found while reading, not confirmed)

These come from the UI agent's running notes before it was cut off. Treat them as leads, not findings.

- `useShortcuts` mutates the shortcut registry during render, and `priority`/`exclusive` are captured only at first registration — possible dead shortcuts after remounts.
- `ink-text-input` 6 inserts Ctrl+letter characters while the same key also fires a registered shortcut (e.g. Ctrl+S/R/N/D inside a focused input).
- `selectedTaskIds` not pruned when tasks are removed → possible phantom multi-selection (the stale `selectedTaskIndex` half is confirmed as UI-07).
- SGR mouse sequence split across two stdin chunks leaks garbage text to Ink (`index.tsx` regex extraction).
- `useShortcutLiteral` doesn't carry a default `doubleTap` into overrides (hint says `F4` while the entry needs `F4 F4`).
- Light theme: `text.muted #d0d7de` on `#fff` ≈ 1.5:1 contrast; hardcoded `"black"/"white"/"cyan"/"gray"` colors in `UpdateBadge`, `TaskRow`, header, empty state.
- `App.tsx`: per-task `subscribe(...persistCurrent)` fires immediately → O(N²) snapshotting on every task change (matters at hundreds/thousands of tasks).
- Mouse any-event tracking is always on with no setting to disable (native text selection needs Shift-drag).
- `TabBar` spacer `<Text>{"  "}</Text>` (space-indentation rule) without `flexShrink={0}`.

---

## 3. Verified OK (checked, no problem)

- `yarn type-check` passes (3.7 s); `yarn lint` passes with **0 warnings** across all 271 `.ts/.tsx` files (it really covers `.tsx`); `vitest run tests/unit` = 176 passed, 1 skipped, in 2 s.
- Unit tests are properly isolated (`GOBLIN_DATA_DIR` temp dirs) — the e2e smoke test (TEST-02) is the exception.
- The single `useInput` rule holds (`ShortcutDispatcher` only); virtually all hints go through the registry (UI-05 is the lone literal found).
- Shortcut dispatch semantics (priority + `exclusive`) are sound; the duplicate default keys I inspected live in different scopes.
- `settings.json` writes are atomic (temp + rename); `sessions.json` writes are atomic and coalesced, off the main thread.
- A graceful `exitApp()` exists (flush session store + cache, restore terminal, forced exit after 8 s) — it is only bypassed by DATA-06/DATA-07.
- The Windows-Terminal-only `screenshot-powershell` step and the headless harness work; the harness is a good base for the regression scenarios proposed above.
- **The happy path works** (given ffmpeg/yt-dlp are present): YouTube Music URL → title/artist/duration → yt-dlp download (~25 MB/s) → `SAVED` with the file at `<out>/<artist> - <title>.flac` and the message `FLAC metadata updated successfully`; Spotify (scrape mode, no credentials) → artist/title + YouTube match; the import options dialog, the Songlink/Claude consent dialogs (declining persists and is logged), quality labelling ("FLAC (transcoded from Opus)"), the output-path preview and the Sessions/Archive/Settings modals all render and respond correctly at 120–160 columns.
- `Tab` behaves as designed (toolbar → task list → lower panel); focus starts on the toolbar.

## 4. Coverage & limits

Eight sub-agents were launched in parallel for: download pipeline, metadata/discovery, core/persistence, UI static review, dynamic TUI exploration, build/release/security, docs/tests, and a live end-to-end pipeline run. **All eight were terminated by an API rate limit (5-hour window, resets 17:40 Paris time) before producing their final reports.** Their saved partial output was used above (`REL-02`, `MD-01/02` experiments, the link check, the UI notes, TUI finding `UI-04`); everything else was done by the orchestrator.

**Not covered or only partially covered** (so the absence of findings there means nothing):

- **The real end-to-end pipeline** was exercised by me only for **one YouTube Music URL** (import → YouTube metadata → MusicBrainz → yt-dlp download → save to FLAC, with the developer's existing ffmpeg/yt-dlp copied into an isolated data dir, so the then-broken ffmpeg bootstrap, since fixed, did not bite) and **one Spotify track in scrape mode** (metadata + YouTube match). Not audited: tag writing in depth (ID3 for non-FLAC, empty-field/erase behaviour, multi-artist handling), the "replace saved file" flow and its diff, file-name sanitising (Windows reserved names, long paths, collisions, cross-drive rename), the overwrite policy, yt-dlp cookies handling, binary integrity (no checksums exist), zip extraction safety, preview playback (mpv) and process cleanup, albums/playlists (collections), non-YouTube/Spotify URLs.
- **Soulseek** (credentials, remote file-name handling, `slsk-client` 1.1.0 vs 2.x), **the Claude provider's process spawn** (shell use, prompt-injection surface, consent flow), Songlink/MusicBrainz rate limiting and User-Agent policy, URL parsing/import fuzzing.
- **UI static review** against `CLAUDE.md` (flexShrink/indentation/`#alias` violations, focus/modal management, accessibility, render performance) beyond the candidates in section K; *runtime* resize, large sessions (2,000+ tasks), NO_COLOR/non-TTY, idle CPU/memory. (A static terminal-size sweep from 100×30 down to 20×8 was done — see UI-06.)
- **Docs/tests deep review**: claim-by-claim README/CLAUDE.md check, project status table (P1–P29 vs reality), coverage numbers, harness cleanup of orphan processes, `yarn test` full run.
- **Core**: updater edge cases (pre-release tags, installer detection), prototype-pollution in `deepMerge`, two-instance behaviour beyond what DATA-05 states.

The sub-agents keep their context: after 17:40 they can be resumed to finish these areas (their scratch work is in `%TEMP%/claude/.../scratchpad/work/<agent>`).

## 5. Side effects of this audit

- While testing the settings row (UI-04) I briefly pointed a *scratch copy's* persisted `appDataDir` at `%APPDATA%/goblin-malin` (the owner's real installed-app folder). The harness runs then **rewrote `app.log` (truncated by the app at start, see DATA-10) and re-saved `cache/api-cache` there**. `sessions.json`, `settings.json`, `.env`, `install.json` and `bin/` were not touched (their timestamps are unchanged). This is DATA-04 in action.
- Network use: one YouTube Music download (~40 MB) and one Spotify scrape plus a few MusicBrainz lookups (Songlink and Claude were declined; no credentials or cookies were used or copied — only `yt-dlp`, `ffmpeg`, `ffprobe` were copied into an isolated temp data dir).
- My isolated scratch data dirs (`%TEMP%/gm-o`, `gm-live`, `gm-sweep`, with the copied binaries and the 39 MB test download) were deleted afterwards. The remaining scratch files (scripts, scenario JSONs, the sub-agents' partial work) live under `%TEMP%/claude/.../scratchpad`.
