# Goblin Malin, code audit (v0.2.4 + Unreleased, commit `bb76b4d`)

Audit date: 2026-11-21. Repository: `Tetraxel/goblin-malin`, `main` at commit `bb76b4d` ("docs(readme): make the screenshots readable and the feature list scannable"). That is the `v0.2.4` tag plus everything under "Unreleased" in `CHANGELOG.md` (Deezer, Apple Music and Tidal, the first-run provider picker, mouse selection, parallel discovery, Claude on request).

The previous audit is [AUDIT-v0.2.3.md](AUDIT-v0.2.3.md) (commit `06347e3`). This one follows the same format. It does two things: it checks what became of the v0.2.3 findings, and it reviews the ~18,000 lines added since then (294 files changed).

Nothing was committed or pushed. The only file added to the working tree is this one. Repro scripts and TUI scenarios were kept in a scratch folder outside the repository; they are reproduced in Appendix A.

---

## Table of contents

- [1. How to read this document](#1-how-to-read-this-document)
- [2. Executive summary](#2-executive-summary)
- [3. What was done, and what was not](#3-what-was-done-and-what-was-not)
- [4. Baseline: the project's own checks](#4-baseline-the-projects-own-checks)
- [5. The v0.2.3 findings, re-checked](#5-the-v023-findings-re-checked)
- [6. Findings, medium severity](#6-findings-medium-severity)
- [7. Findings, low severity and hardening](#7-findings-low-severity-and-hardening)
- [8. Security review of the new surfaces](#8-security-review-of-the-new-surfaces)
- [9. Performance](#9-performance)
- [10. Rules of CLAUDE.md](#10-rules-of-claudemd)
- [11. Tests, CI, documentation](#11-tests-ci-documentation)
- [12. Things checked and found correct](#12-things-checked-and-found-correct)
- [13. Suggested order of work](#13-suggested-order-of-work)
- [Appendix A: reproduction scripts and scenarios](#appendix-a-reproduction-scripts-and-scenarios)
- [Appendix B: index of all findings](#appendix-b-index-of-all-findings)

---

## 1. How to read this document

Every finding has:

- an **ID** (area prefix + number). IDs continue the v0.2.3 numbering where an area already existed (`DOC-03`, `LOCK-02`, `UI-03`); new areas start at 01;
- a **severity**: High (data loss, wrong output, broken promise of the product, or a security problem with a realistic path), Medium (real bug or risk with a narrower trigger), Low (edge case, hardening, polish);
- a **status**:
    - **Reproduced**: I ran it and saw it happen (script, live TUI run or command, all in Appendix A);
    - **Confirmed by reading**: the code path is unambiguous, but I did not execute it;
    - **To verify**: plausible from the code, needs a check;
- the **location** as `file:line` (lines are those of commit `bb76b4d`);
- the **impact** in user terms and a **suggested fix**.

---

## 2. Executive summary

The fixes from the v0.2.3 audit hold. Every check the project has passes (type-check, lint with 0 warnings, prettier, UTF-8, 1,735 tests including the end-to-end ones, `yarn audit` with 0 advisories), and the destructive paths that were the core of the last audit (restart, reset, session switch) now ask first or keep the user's data.

The new code is in the same careful style: the URL parsers of the three new platforms are strict (scheme, host allow-list, numeric ids), every new outbound call has a time limit, and no provider key is branched on outside the services. The findings are therefore mostly about **the edges of the new features**. The provider registry made it easy to add platforms, but a few capabilities sit on one code path and not on its siblings: the "yt-dlp is off" guard, the stop signal, short-link resolution.

**No high-severity finding this time.**

### Counts

| Severity  | Count  | Reproduced | Confirmed by reading | To verify |
| --------- | ------ | ---------- | -------------------- | --------- |
| High      | 0      | 0          | 0                    | 0         |
| Medium    | 2      | 1          | 1                    | 0         |
| Low       | 16     | 6          | 7                    | 3         |
| **Total** | **18** | **7**      | **8**                | **3**     |

### The things I would fix first

| ID        | One line                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YTDLP-01  | With yt-dlp switched off, a SoundCloud link found by MusicBrainz makes the app download yt-dlp **and** the ffmpeg archive (360 MB on disk) to read one page         |
| CLAUDE-04 | "Ask Claude" cannot be stopped: the toolbar's Stop and Delete do not reach the `claude -p` process, which runs to its time limit and spends the plan anyway         |
| LR-01     | Every track that has not been read yet offers "Ask Claude to look for …", including its own platform; pressing it only logs a warning                               |
| PERF-01   | Copying a cell (`Ctrl+C`) freezes the interface for about 300 ms on Windows (`clipboard.writeSync`), although the new mouse selection already copies asynchronously |
| DOC-03    | `CLAUDE.md` and `TODO.md` still say v0.2.3 is the latest release and Spotify / YouTube are the only inputs; the `zod` advisory that TODO waits on is gone           |

### General impressions

- **Strong points of the new code**: the three new metadata providers (small, typed, cached as plain data, negative results kept one day only, an ISRC lookup first on Deezer); the M4A freeform-atom writer (checked on real files below: plain, faststart and with a cover, all still decode and read correctly in mutagen); the cookies import (checked before it replaces anything, written `0600` beside its destination and renamed); the mouse selection (pure functions over the painted cells, pane-bounded, no React involvement); `Semaphore.whileWaiting` (gives the metadata slot back while a person or a slow call is awaited).
- **Weak points**: capability checks applied on one path only (YTDLP-01, YTDLP-02, CLAUDE-04, SC-01); a button offered in a state where it cannot work (LR-01); two places that still block the UI thread with a child process (PERF-01); and documentation that did not move with the release (DOC-03).

---

## 3. What was done, and what was not

### Done

- Read the v0.2.3 audit and the whole `CHANGELOG.md` "Unreleased" and `[0.2.4]` sections, `TODO.md`, `docs/ARCHITECTURE.md`, `README.md`.
- Read in full: the Deezer, Apple Music, Tidal and SoundCloud services, URL parsers, converters and API clients (`deezer-client.ts`, `itunes-client.ts`, `ytdlp-client.ts`); the discovery stage of `downloadTask.ts` (primary fetch, parallel Phase A, Phase B, skips, last-resort offers, `rediscoverPart`, `startSingleProviderDiscovery`); `semaphore.ts`, `stageLimiters.ts`; `mp4Freeform.ts` and its use in `tagAudioFile.ts`; the cookies import (`cookiesFile.ts`, `cookiesSettings.ts`); Picard (`picard.ts`, `picardActions.ts`); the selection (`selection.ts`, `clipboardWrite.ts`) and clipboard reads; `providerOnboarding.ts`; `claudeQuota.ts`; `instanceLock.ts`; `confirmReset.ts`, `CollectionTask.restart`, the restart actions in `contextualActions.ts`; the import flow (`useImportFlow.ts`); the diff of the Claude clients and of the agent's write path since `06347e3`.
- Ran the project's checks (section 4).
- **Live network runs**, which the v0.2.3 audit could not do: real Deezer, Apple Music and Tidal tracks and a Deezer album imported and run in the TUI harness, against the real services (Deezer API, iTunes API, Tidal pages, YouTube Music, MusicBrainz, SoundCloud through yt-dlp).
- Two repro scripts (Apple pacing, M4A tagging read back with mutagen 1.47), seven TUI scenarios, a few `curl` and timing checks. All on **Windows 11**, the app's main platform.

### Not done, so the absence of findings there means nothing

- No Soulseek session, no real download through yt-dlp (downloads were off in every run), no Claude CLI call (chat or last resort).
- No macOS or Linux run.
- Only skimmed: `MatrixDialogModal.tsx`, `ActionsMenu.tsx`, `screenSelection.ts` and the Ink output patch, the chat panel changes, `MetadataGroupStatus.tsx`, the Spotify and YouTube search changes (scored search, video uploads), `groupTasks.ts`.
- No fuzzing of the new URL parsers beyond reading them and a handful of shapes.

---

## 4. Baseline: the project's own checks

| Check                    | Result                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `yarn type-check`        | Passes                                                                                          |
| `yarn lint`              | Passes, **0 warnings** (25 in v0.2.3)                                                           |
| `yarn format:check`      | Passes                                                                                          |
| `yarn check:utf8`        | Passes (742 files; BOMs now refused)                                                            |
| `npx vitest run`         | **146 files passed; 1,735 tests passed, 2 skipped**, 50 s, on Windows. The e2e tests pass too   |
| `yarn audit` (all deps)  | **0 vulnerabilities** (621 packages). The `zod` advisory listed in `TODO.md` is no longer there |
| `goblin-malin --version` | Prints `0.2.4` and exits 0 (CLI-01 holds)                                                       |
| Started without a TTY    | One line ("needs an interactive terminal") and exit code 1 (TTY-01 holds)                       |

Remark: the selection and "incremental rendering" e2e tests that failed on a clean checkout in earlier rounds now pass on Windows.

---

## 5. The v0.2.3 findings, re-checked

All 78 findings of v0.2.3 are marked DONE, PARTLY DONE, WON'T FIX or NOT A PROBLEM in that file. I re-checked the ones I could exercise. The others are taken as they are described there.

| ID                     | Re-check                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TAG-01, TAG-02         | **Holds.** Real M4A files tagged by `tagAudioFile` and read back with mutagen: `©nam`, `©ART`, `©alb`, `©day`, `trkn`, `©gen`, `aART`, `tmpo`, `----:com.apple.iTunes:ISRC`, the MusicBrainz ids, and `covr` kept |
| BIN-01, BIN-02         | **Holds** for what a live run showed: yt-dlp and the ffmpeg `n9.0` archive downloaded with "SHA-256 … verified", put in place under their versioned names                                                         |
| TTY-01, CLI-01         | **Holds** (section 4)                                                                                                                                                                                             |
| DATA-09                | **Holds**: a Deezer album with a track already in the list reads "14 tracks (1 already in the queue elsewhere)"                                                                                                   |
| RUN-04                 | **Partly**: the pipeline's stages take the stop, but the new "Ask Claude" path does not (CLAUDE-04)                                                                                                               |
| DL-07                  | **Partly**: `--ignore-config` is on downloads, not on the yt-dlp runs that now read SoundCloud pages (YTDLP-02)                                                                                                   |
| RUN-03                 | **Partly**: the collection restart checks for busy tracks before its dialog, not after (RESTART-01)                                                                                                               |
| QUAL-03                | **Partly**: no new synchronous file call in the download path, but synchronous child processes for the clipboard (PERF-01)                                                                                        |
| DEP-01                 | **Holds**, and the `zod` advisory is gone (DOC-03: `TODO.md` still waits for it)                                                                                                                                  |
| SLSK-03, TAG-04        | Still partly done as described (listening port; several artists in one value for MP3, Ogg, Opus, M4A: mutagen shows `©ART` = `A, B`)                                                                              |
| QUAL-05, LOG-02        | Still partly done as described                                                                                                                                                                                    |
| BIN-02 (not done part) | Unchanged: no SHA-256 pinned in the source; macOS ffmpeg and mpv downloads unverified                                                                                                                             |

`TODO.md` items still open and not repeated here as findings: saving cannot be cancelled; a format with no tag writer is saved untagged; no Linux ffmpeg download.

---

## 6. Findings, medium severity

### YTDLP-01. With yt-dlp switched off, a SoundCloud link found by discovery downloads yt-dlp and ffmpeg anyway

- **Status**: Reproduced (live TUI run, data folder kept and inspected).
- **Where**: `src/flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService.ts:142` (`getTrackMetadata`, no guard), `:73` (`expandCollection`, no guard), compared with `:184` (`searchTrack`, which does check `isYtDlpEnabled()`); `src/flows/musicDownloadFlow/services/apis/ytdlp-client.ts:23-33` (`getYtDlpClient` always runs `ensureYtDlpSetup` **and** `ensureFfmpeg`), `:69` (`readYtDlpInfo`).
- **What happens**: `ytdlp-client.ts` says it plainly: reading a site through yt-dlp "makes the app download yt-dlp and ffmpeg when they are missing: not something to do for a user who turned yt-dlp off (a Soulseek-only setup)". `searchTrack` respects that. But MusicBrainz (and Songlink) return SoundCloud links for many tracks. Discovery then calls `SoundCloudService.getTrackMetadata(url)` to enrich them, and that path has no guard. Reading one page sets up the whole yt-dlp client, including ffmpeg, which `--dump-single-json` does not need at all.
- **Evidence** (fresh data folder, Spotify, yt-dlp and Soulseek off, Apple Music off, Songlink off; one Deezer track run with metadata only):

    ```
    app.log  "yt-dlp is switched off: not searching SoundCloud"                  <- searchTrack, guarded
    app.log  "Reading SoundCloud track: https://soundcloud.com/daftpunkofficialmusic/harder-better-faster"
    app.log  "yt-dlp 2026.10.26 not found, downloading…"
    app.log  "ffmpeg n9.0-2026-11 not found, downloading…"
    bin/     yt-dlp_2026.10.26.exe 23.5 MB, ffmpeg_n9.0-2026-11.exe 168 MB, ffprobe_n9.0-2026-11.exe 168 MB
    ```

    The task list then shows a SoundCloud id for a track that nothing can download (yt-dlp is off).

- **Why it matters**: a user who chose Soulseek only (or who has no room or bandwidth for ~360 MB of tools) gets them anyway, silently, on the first track MusicBrainz knows a SoundCloud upload for. The same happens with a pasted SoundCloud set or track, where it is more defensible, but the settings say nothing about it.
- **Suggested fix**: (1) guard `getTrackMetadata` and `expandCollection` like `searchTrack`: when yt-dlp is off, a discovered SoundCloud link stays a bare link (no enrichment), and a pasted one fails with "SoundCloud is read through yt-dlp, which is switched off"; (2) let `readYtDlpInfo` use a client set up without ffmpeg (`new YtDlp({ binaryPath })`), so reading a page never pulls the 200 MB archive; (3) a unit test with yt-dlp off and a discovery result on `soundcloud`.

### CLAUDE-04. "Ask Claude" cannot be stopped, and keeps spending the plan after Stop

- **Status**: Confirmed by reading.
- **Where**: `src/flows/musicDownloadFlow/discoveryMetadataService.ts:7-11` (`DiscoveryContext` has no `signal`), `src/flows/musicDownloadFlow/utils/downloadTask.ts:1708-1720` (`rediscoverPart` builds a signal but does not hand it to `startSingleProviderDiscovery`), `:1169` (`startSingleProviderDiscovery(serviceKey)`, no signal), `:805` (the call itself). The client underneath does accept one: `services/apis/claude-client.ts:61`, `:220`, `:279`.
- **What happens**: the "Ask Claude to look for …" button (and its `A` key) goes through `rediscoverPart(key)`. The stop chain ends there: `startSingleProviderDiscovery` → `runDiscoveryService` → `discoverFromUri(primary, { wantedPlatforms })`, and nothing on that path carries a signal. The `claude -p` process (a web search, up to its time limit) runs to the end, uses the user's plan, and its result is merged into the track afterwards.
- **Why it matters**:
    - This is the one path that is slow (tens of seconds to minutes) **and** costs the user's own quota, which makes it the one that most needs a stop.
    - In practice there is no way to end it short of quitting. A part run started by hand has no toolbar Stop of its own when no batch is going (the leftover of RUN-04 in v0.2.3), and Delete skips a busy track.
    - The `rediscoverPart` comment says the opposite of what happens ("Never runs a last-resort service (Claude)… A search of one provider is a single request and finishes by itself", `:1704-1706`).
- **Suggested fix**: add `signal?: AbortSignal` to `DiscoveryContext`, pass it from `rediscoverPart` through `startSingleProviderDiscovery` and `runDiscoveryService` to `ClaudeClient.run`, and wait with `untilAborted`. Give the busy "Ask Claude" button a "Stop" of its own, as the platform groups have "Skip". Fix the comment. Add a test in `tests/unit/stopRuns.test.ts`.

---

## 7. Findings, low severity and hardening

Shorter entries. "Reading" means confirmed by reading.

### Discovery and the new providers

- **LR-01. "Ask Claude" is offered on tracks that have not been read, for their own platform too, and does nothing.** (Reproduced, TUI) `downloadTask.ts:1217-1230` (`getLastResortOffers`) and `:1081-1091` (`getMissingPlatforms`). The offer is only held back while a fetch or a search _runs_. A pending track (imported, not run yet) or one whose primary fetch failed has no results anywhere, so every enabled platform is "missing", the track's own included: a Deezer link shows "Ask Claude to look for Apple Music, Deezer, SoundCloud, YouTube [A]". Pressing `A` gives `[WARN] No primary metadata available for re-discovery`, and nothing else. Fix: offer nothing until `primaryMetadataFetched`, and leave the primary platform out of `missing`.
- **APPLE-01. Apple Music's pacing is one app-wide queue that a stop or a skip cannot leave.** (Reproduced for the timing; the rest by reading) `services/apis/itunes-client.ts:11` (3 s between calls), `:30-38` (`waitForSlot` reserves the next slot before waiting), `:49` (`itunesGet` takes no signal). Six searches at once are answered at 0, 3, 6, 9, 12 and 15 s, and a call made after them waits its own 3 s. The spacing matches Apple's "about 20 calls a minute" and the default cap of 4 tasks keeps the queue short. But:
    - a search the user skips (the group's Skip) or stops keeps its reservation, and still calls Apple when its turn comes;
    - each track's Phase B (Songlink, MusicBrainz) waits for its Apple answer (`downloadTask.ts:707`);
    - the chat's `search_music` (25 s limit, `downloadTask.ts:100`) queues behind the pipeline's reservations, and one 403 adds a 10 s retry without pushing the shared `nextSlot`, so the others keep hitting Apple every 3 s while it refuses.

    Fix: give `itunesGet` a signal and drop a reservation whose caller is gone; on a 403/429 push `nextSlot` for everyone.

- **DEEZER-01. `deezer.page.link` is a dead host.** (Reproduced, `curl`) `deezerUrl.ts:5`. Firebase Dynamic Links (`*.page.link`) were shut down in August 2025; `https://deezer.page.link/<code>` answers 404. Such a link is still recognised as Deezer, imported as a track, then fails. Fix: drop the host, or say "this kind of Deezer link no longer works" at import. (`link.deezer.com/s/…` works and is followed correctly.)
- **DEEZER-02. No pacing for Deezer, and unreadable tracks of an album disappear silently.** (To verify / Reading) `deezer-client.ts` has no spacing or retry. Deezer documents 50 requests per 5 seconds, and its quota error (code 4) is treated as an ordinary failure, so the platform's group says "failed". I did not reach the limit with the default caps. Separately, `DeezerService.ts:128-132` leaves out `readable: false` tracks (region-blocked) and reports `totalCount` as what is left, so a 14-track album can show 12 with no explanation (the same class as DATA-09, which was fixed for duplicates). Fix: count and say "2 not available in your country"; space calls under the published limit.
- **SC-01. An `on.soundcloud.com` short link to a set is imported as a track and fails.** (Reading) `soundcloudUrl.ts:5`, `:67-70` (a short link is always `type: "track"`); `SoundCloudService` has no `static resolveLink`, which is exactly what that capability exists for (CLAUDE.md: "a short link to an album becomes a collection"). Only Deezer implements it. SoundCloud's share button gives these links for sets as well; the result is "Not a SoundCloud track". Fix: a `resolveLink` that follows `on.soundcloud.com` (one HEAD request, like Deezer's).
- **YTDLP-02. The yt-dlp runs that read SoundCloud ignore the DL-07 fix and the stop.** (Reading) `ytdlp-client.ts:75`: `exec(url, { dumpSingleJson, flatPlaylist, ignoreNoFormatsError })`, with no `ignoreConfig`. A user's `yt-dlp.conf` (`--print …`, `-o`, `--flat-playlist` off…) changes the JSON these runs print, and the parse fails or reads the wrong thing; the download path was fixed for exactly this in v0.2.3. These runs also take no signal: a skipped SoundCloud search or a stopped track leaves its yt-dlp process running until the 60 s (120 s for a set) limit. Fix: `ignoreConfig: true`, and pass the run's signal to kill the process.
- **SEM-01. A branch still waiting when its run ends is counted twice for a moment.** (To verify) `utils/semaphore.ts:29-40`, `:51-69`. When a run's `fn` returns while one of its branches is inside `whileWaiting` (a platform search the user skipped, sleeping in Apple's queue), `run`'s `finally` releases a permit that `whileWaiting` had already given back, and the branch later acquires one that no run releases. The two cancel out in the end, but until the branch finishes the metadata stage runs one over its cap per such branch. Fix: when the run ends with `lent > 0`, let the last branch's `finally` skip its acquire (mark the permit "run over").

### Running

- **RESTART-01. A collection restart checks for busy tracks before its dialog, not after.** (Reading) `contextualActions.ts:655-671`, `collectionTask.ts:146`. `restartCollection` counts busy tracks, then awaits the "Archive / Delete tracks, then restart" dialog, then calls `c.restart()`, which `removeTasks` every child without checking. While the dialog is open a "Run all" that is going can start one of the album's pending tracks. Archive skips it (busy), restart removes it anyway, and it keeps running detached, which is the RUN-03 situation of v0.2.3. Also, when tracks are busy, the refusal is only a footer log line ("Stop them first"), so `R` looks like it did nothing. Fix: count again after the dialog (or have `CollectionTask.restart` refuse when a child `isBusy()`), and say it in a dialog.
- **LOCK-02. Two narrow ways to get two instances on one data folder.** (To verify) `utils/instanceLock.ts:141`, `:114-132`. (1) `writeFileSync(…, { flag: "wx" })` creates the file, then writes the pid: in between, a second instance reads an empty file, judges it unreadable ("stale"), moves it aside and deletes it; on Linux and macOS the first instance writes into a deleted file and both run. On Windows the rename of an open file fails, which saves it. (2) A process that is suspended for more than five minutes (SIGSTOP, a debugger) loses its lock to the next launch. Both are rare. Fix for (1): write the pid to a temporary file and `link` / rename it into place, so the lock never exists empty.

### Downloads, cookies, Picard

- **COOKIE-02. The imported cookies.txt keeps every site's cookies.** (Reading) `cookiesFile.ts:133-173`. The import checks that YouTube cookies are present, then copies the whole file. Several exporters export all of the browser's cookies by default (banks, mail), and the copy then lives in `bin/cookies.txt` and is handed to yt-dlp on every run. yt-dlp only sends a cookie to its own domain, so the exposure is the file at rest. Fix: keep only the lines for `youtube.com` / `google.com` (and say how many were dropped).
- **PICARD-01. Any program on port 8000 is taken for Picard, and a batch cannot be stopped.** (Reading) `musicbrainz/picard.ts:10`, `:72-80` ("Any HTTP answer counts"), `picardActions.ts:149-157`. Port 8000 is also the default of `python -m http.server` and many dev servers. "Open all tracks in MusicBrainz Picard" then reports nothing wrong while sending hundreds of `GET /openalbum?id=…` to another program. A batch of several hundred releases has no progress and no way to stop. Fix: check the answer (Picard's integration answers with its own page or a redirect to it), show a progress line, and let Esc stop the loop.

### Interface

- **PERF-01. Copying a cell blocks the interface for about 300 ms on Windows.** (Reproduced, timing) `contextualActions.ts:86`, `:100`, `:806`, `:808` (`clipboard.writeSync`), `DownloadSourceDetail.tsx:525` (`clipboard.readSync`), `:541`. clipboardy's synchronous calls start a process and wait for it. Measured on this machine: `writeSync` 296 ms on average, `readSync` 250 ms. Every `Ctrl+C` on a cell or URL is a frozen frame of that length. The new mouse selection already uses the asynchronous `clipboard.write` (`clipboardWrite.ts`). Fix: use `copyToClipboard` / `readClipboard` everywhere (they also add OSC 52, which makes copying work over SSH).
- **UI-03. The provider picker at 80×24 shows one platform at a time.** (Reproduced, TUI) The first-run picker fits at 80×24, but the platform grid shows a single row between "↑ more" / "↓ more", so the point of the screen (seeing which platforms feed which download provider) is lost on the default size of many terminals. The intro also wraps with a leading space (" the other platforms"). Fix: shorten the intro or drop it below a height, and let the grid take the freed rows.
- **UX-01. "Fetch Metadata" in the import dialog does not fetch anything.** (Reproduced, TUI; this predates v0.2.4) `ImportModal.tsx:31-33`, `useImportFlow.ts:128`. The three choices only set TAG? / DL? on the new tasks: after "Fetch Metadata" the tracks stay "No status" until Run is pressed (45 s observed). The README's step 1 says "Paste … The app recognises the platform and reads the track." Fix: either start the imported tasks for the first two choices, or word them as what they do ("Tag and download", "Tag only", "Add only") with "press Run" under them.

### Other

- **QUOTA-01. The plan-usage file is saved with a fixed temp name, unserialised.** (Reading) `agent/claudeQuota.ts:105-109`. Two messages that report usage close together write the same `claude-quota.json.tmp` at once, and the plain `fs.rename` has no Windows retry (`renameReplacing` is used elsewhere for that). The worst case is a warning and a stale figure. Fix: the app's `dataFile` helper.
- **DOC-03. Documentation that did not move with v0.2.4.** (Reading)
    - `CLAUDE.md:6`: "v0.2.3 released" and "Spotify / YouTube links, albums and playlists"; `v0.2.4` is tagged, and there are six platforms.
    - `TODO.md:3` and `:9`: "v0.2.3 released", "`v0.2.3` is the latest"; its "Dependencies left: `zod` advisory" line waits for something `yarn audit` no longer reports.
    - `docs/ARCHITECTURE.md:11-12`: the diagram's import and primary-metadata columns list Spotify and YouTube only; the registry table below it is not aligned.
    - `downloadTask.ts:1704-1706`: the `rediscoverPart` comment (CLAUDE-04).
    - `providerOnboarding.ts:28`: `answerPatch`'s consent branch cannot be reached (the picker lists no consent-gated provider), so its comment promises something that never happens.

---

## 8. Security review of the new surfaces

Only what changed since v0.2.3; section 8 of that audit still describes the rest.

### 8.1 New outbound requests

| Host                                  | Called by                   | What is sent                                                      | Notes                                                                                         |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `api.deezer.com`                      | `deezer-client.ts`          | track / album / playlist ids, ISRCs, artist+title                 | No key. 30 s limit (`fetchWithTimeout`). No pacing (DEEZER-02)                                |
| `link.deezer.com`, `deezer.page.link` | `followShortLink`           | the short link                                                    | `redirect: "follow"`; only the final address is read and re-parsed as Deezer. DEEZER-01       |
| `itunes.apple.com`                    | `itunes-client.ts`          | ids, artist+title, store                                          | No key. Paced (APPLE-01)                                                                      |
| `tidal.com`                           | `TidalService.getRecording` | a numeric track id                                                | HTML page; only `application/ld+json` blocks are parsed, with `JSON.parse` in a `try`         |
| SoundCloud (via yt-dlp)               | `readYtDlpInfo`             | a permalink built from a parsed id, or `scsearchN:<artist title>` | No shell; the search text cannot start with `-` (it follows `scsearchN:`). YTDLP-01, YTDLP-02 |
| `127.0.0.1:<picard port>`             | `sendToPicard`              | `GET /openalbum?id=<MBID>`                                        | PICARD-01                                                                                     |

Every new URL is built from a parsed id (digits for Deezer, Apple and Tidal; a lower-cased permalink for SoundCloud), so a remote answer cannot point the app at an arbitrary address. The only redirect that is followed is Deezer's short link, and what it lands on is re-checked by `parseDeezerUrl`.

### 8.2 Files from the user

- The cookies import reads a path the user typed or dropped (`cleanPastedPath` handles quotes, PowerShell's `& '…'`, escaped spaces and `file://`). It refuses directories and files over 5 MB, never echoes cookie values, writes `0600`, and goes through a staging file. See COOKIE-02 for what it keeps.

### 8.3 The clipboard

- The mouse selection writes OSC 52 (base64, capped at 100 kB, wrapped for tmux) and calls the system tool asynchronously. The text copied is what was painted. A masked field stays masked, since the cells hold the mask.
- Clipboard reads (`Ctrl+V` in the chat, the import) take the whole clipboard. The chat input sanitises typed control characters (`sanitizeTyped`).

### 8.4 Child processes

- Nothing new reaches a shell. The yt-dlp info runs go through `ytdlp-nodejs`, which spawns with `shell: false` and puts the URL after `--`.
- The Claude CLI now runs in `<data>/claude-work` (mode 0700) for both clients, and the MCP config is created there with `wx` and `0600`. Verified by reading.

### 8.5 Agent

- The `rediscover` tool filters out last-resort providers (`writeTools.ts:294-299`), so the chat cannot start a Claude web search on its own. `agentWrite` is serialised per task. No new write tool bypasses `agentWrite`.

---

## 9. Performance

### Measured

| What                                  | Result                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `clipboard.writeSync` / `readSync`    | 296 ms / 250 ms per call on Windows 11 (PERF-01)                                          |
| Apple Music pacing                    | 3,000 ms between any two calls of the app (APPLE-01)                                      |
| Live discovery, 1 track (Deezer)      | YouTube, Apple Music and Deezer results within ~10 s; MusicBrainz verdict later           |
| Live discovery, 14-track Deezer album | 9 of 14 tracks through discovery after 90 s (MusicBrainz identity check on, default caps) |

### Seen but not measured properly

- In one live run the harness's "stable" step never settled: about 6.7 MB of output had reached the terminal in a little over a minute (boot, import, three tracks discovering, a consent dialog open, 200×50). Spinners and timers repaint the whole screen by design; I did not isolate how much of that was idle repainting. Worth one run of `perf-idle.json` with a running discovery and a dialog open.
- Not run: the production latency bench, the 2,000-task profile (the v0.2.3 numbers stand; the list rendering was not changed much).

---

## 10. Rules of CLAUDE.md

### Rules that hold

- **Providers are not hard-coded**: no `=== "spotify"`-style comparison outside the services (grep over `components/`, `base/`, `columns/`, `utils/`); platform aliases go through `platformRegistry` (`itunes` for Apple Music).
- **Credentials through `appSecrets`**: no `process.env.SPOTIFY…` / `SOULSEEK…` read in `src/`.
- **No synchronous file-system call added to the download path.** The remaining ones are in the logger's boot, the settings writer and `sessionManager.fileIsGone`, as noted in v0.2.3.
- **Calls to the outside world have a limit**: every new client uses `fetchWithTimeout` or `withTimeout`.
- **One `useInput`**: unchanged.
- **Hints by shortcut id**: the new `A` ("Ask Claude") is a registered, rebindable shortcut, and its hint reads the live binding.

### Rules that are bent

- "No synchronous … calls in render or in the download path": a synchronous child process on a key press is the same freeze in another form (PERF-01).
- "Every run a task makes on its own has its own stop": except "Ask Claude" (CLAUDE-04).
- "Adding a provider requires changes in only two places": true. But a capability that exists for a reason (`resolveLink`) is easy to forget on a new provider (SC-01). A unit test that every provider whose parser accepts a short-link host also declares `resolveLink` would catch it.

---

## 11. Tests, CI, documentation

- **Test gaps that match the findings**: no test runs discovery with yt-dlp off and a SoundCloud discovery result (YTDLP-01); no test stops a last-resort call (CLAUDE-04); no test asks `getLastResortOffers()` on a pending task (LR-01); no test of `itunesGet` with an aborted caller (APPLE-01).
- The live behaviour of the new providers depends on pages and APIs that change (Tidal's JSON-LD especially). A scheduled CI job that runs one real lookup per provider and only warns would catch a silent break before users do.
- Documentation: DOC-03.

---

## 12. Things checked and found correct

- The URL parsers of Deezer, Apple Music and Tidal: http(s) only, an allow-list of hosts, numeric ids, language and region prefixes, Tidal's share links ending in `/u`, Apple's `?i=` track inside an album link, older `itunes.apple.com` links with `id123`.
- Deezer: ISRC lookup first (a "not found" is cached one day only), then a scored name search; album details take the ISRCs from the track list (checked live: `/album/<id>/tracks` carries them) and only ask the missing ones.
- Tidal: the live page of a track carries a `MusicRecording` with name, artists, ISO 8601 duration, `isrcCode` and album, exactly what `extractTidalRecording` reads.
- Apple Music: a link from another store falls back to the US store; the pacing gives the metadata slot back while it waits.
- Parallel discovery: each platform shows its own group and Skip; a skipped or late search cannot add results after the stage ended (`cancelled()`), and one that is still "searching" at the end is marked skipped.
- `mp4Freeform.ts`: chunk offsets are shifted only when `moov` precedes `mdat` (checked on a faststart file, which still decodes), 64-bit atoms are refused, the file is rewritten beside itself and renamed.
- The cookies import refuses JSON exports, untabbed text, files without YouTube cookies and files whose YouTube cookies all expired, and adds the Netscape header yt-dlp insists on.
- The collection restart asks "archive or delete" with Cancel first; the track restart asks with Cancel first.
- The instance lock's heartbeat and the grace period for a machine waking up.
- `whileWaiting` with several parallel branches of one run (the comment's "given back by the first, taken again by the last" is what the code does).
- The agent cannot start a last-resort service; writes are serialised per track.

---

## 13. Suggested order of work

**First** (each is small):

1. YTDLP-01: guard `getTrackMetadata` / `expandCollection`, and read pages with a client that needs no ffmpeg. Add `ignoreConfig` while there (YTDLP-02).
2. CLAUDE-04: a signal in `DiscoveryContext`, down to `ClaudeClient.run`; a Stop on the busy button.
3. LR-01: no offer before the primary metadata, never for the primary platform.
4. PERF-01: replace the four `writeSync` and the `readSync` with the async helpers.
5. DOC-03: CLAUDE.md, TODO.md, ARCHITECTURE.md.

**Then**: RESTART-01, APPLE-01, SC-01, DEEZER-01, DEEZER-02, PICARD-01.

**Then the hardening**: COOKIE-02, LOCK-02, SEM-01, QUOTA-01, UI-03, UX-01.

---

## Appendix A: reproduction scripts and scenarios

Scripts were run from the repository root with a throwaway data folder. On Windows the app's sources are imported through a `file:///` URL (tsx refuses a bare `C:/` path), and the scratch folder needs a `package.json` with `{"type":"module"}`.

```bash
GOBLIN_DATA_DIR="$(mktemp -d)" npx tsx <script>.ts
```

### A.1 `r1_itunes_pacing.ts` (APPLE-01)

```ts
// APPLE-01: Apple's 3 s pacing is one global queue; itunesGet takes no signal.
const R = "file:///C:/path/to/goblin-malin/src";
const calls: number[] = [];
const t0 = Date.now();
globalThis.fetch = (async () => {
    calls.push(Date.now() - t0);
    return new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 });
}) as typeof fetch;
const { itunesGet } = await import(`${R}/flows/musicDownloadFlow/services/apis/itunes-client.ts`);

const N = 6; // six tracks of an album discovering at once
const done = await Promise.all(
    Array.from({ length: N }, (_, i) => itunesGet("search", { term: `track ${i}` }).then(() => Date.now() - t0))
);
console.log("answer times (ms):", done.map((d) => Math.round(d / 100) * 100).join(", "));
const late = Date.now();
await itunesGet("search", { term: "chat search" });
console.log("an unrelated call made after them waited:", Math.round((Date.now() - late) / 100) * 100, "ms");
```

Output:

```
answer times (ms): 0, 3000, 6000, 9000, 12000, 15000
an unrelated call made after them waited: 3000 ms
```

### A.2 `r2_m4a.ts` (re-check of TAG-01 / TAG-02)

Test files made with the app's own ffmpeg (`bin/ffmpeg_n9.0-2026-11.exe`):

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a aac plain.m4a
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -c:a aac -movflags +faststart faststart.m4a
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -f lavfi -i "color=red:s=64x64:d=1" \
       -map 0:a -map 1:v -frames:v 1 -c:a aac -c:v png -disposition:v attached_pic -movflags +faststart cover-faststart.m4a
```

```ts
import fs from "fs";
const R = "file:///C:/path/to/goblin-malin/src";
const { tagAudioFile } = await import(`${R}/flows/musicDownloadFlow/utils/tagAudioFile.ts`);
const dir = process.argv[2];
for (const name of ["plain", "faststart", "cover-faststart"]) {
    const file = `${dir}/${name}-tagged.m4a`;
    fs.copyFileSync(`${dir}/${name}.m4a`, file);
    await tagAudioFile(file, {
        trackTitle: "Titre é",
        artists: ["A", "B"],
        albumName: "Album",
        year: "2001",
        date: "2001-03-12",
        trackNumber: "4",
        isrc: "GBDUW0000059",
        bpm: 123,
        key: "Am",
        genres: ["Electronic"],
        musicBrainzTrackId: "f1a6a40f-78f5-4918-968d-f64363bae94c",
        musicBrainzAlbumId: "48117b82-8b0b-4f2d-8a2d-7f5c3f1b7b1a",
    });
}
```

Checked with `ffmpeg -v error -i <file> -f null -` (all three decode) and mutagen:

```
['----:com.apple.iTunes:ISRC', '----:com.apple.iTunes:MusicBrainz Album Id', '----:com.apple.iTunes:MusicBrainz Track Id',
 '----:com.apple.iTunes:initialkey', 'aART', ('covr' on the third file), 'tmpo', 'trkn', '©ART', '©alb', '©day', '©gen', '©nam', '©too']
```

### A.3 Clipboard timing (PERF-01)

```bash
node -e '
import("clipboardy").then(async ({ default: c }) => {
  const prev = await c.read().catch(() => "");
  let t = performance.now(); for (let i = 0; i < 5; i++) c.writeSync("x" + i); const w = (performance.now() - t) / 5;
  t = performance.now(); c.readSync(); const r = performance.now() - t;
  await c.write(prev);   // put the user clipboard back
  console.log("writeSync avg ms:", w.toFixed(1), " readSync ms:", r.toFixed(1));
});'
# writeSync avg ms: 296.3  readSync ms: 250.2
```

### A.4 TUI scenarios (run with `yarn tsx scripts/tui-test/cli.ts <file>`)

The settings block shared by the live runs (no Spotify wizard, no downloads, no picker):

```json
"settings": {
    "music": {
        "onboarding": { "providersChosen": true },
        "metadata": {
            "providers": { "spotify": { "enabled": false } },
            "discoveryProviders": { "songlink": { "enabled": false, "consentAsked": true } }
        },
        "download": { "providers": { "ytdlp": { "enabled": false }, "soulseek": { "enabled": false } } }
    }
}
```

**YTDLP-01** (add `"appleMusic": { "enabled": false }` to the metadata providers; run with `GOBLIN_TUI_KEEP_DATA=1`, then look at `bin/` and `app.log` in the folder the harness prints):

```json
{
    "terminal": { "cols": 200, "rows": 50 },
    "dataDir": "scripts/tui-test/fixtures/empty",
    "settings": "… as above …",
    "steps": [
        { "type": "stable", "timeout": 10000 },
        { "type": "type", "text": "https://www.deezer.com/track/3135556" },
        { "type": "stable" },
        { "type": "key", "key": "↓" },
        { "type": "key", "key": "Enter" },
        { "type": "stable" },
        { "type": "key", "key": "Enter" },
        { "type": "wait", "ms": 120000 },
        { "type": "snapshot", "name": "run-120s" }
    ]
}
```

The second `Enter` lands on the toolbar's Run button (focus starts on the toolbar). Do not put a `stable` step after a long run: the spinners keep the output from going quiet.

**LR-01** (same settings; the track is imported but not run):

```json
"steps": [
    { "type": "stable", "timeout": 10000 },
    { "type": "type", "text": "https://www.deezer.com/track/3135556" },
    { "type": "stable" },
    { "type": "key", "key": "↓" },
    { "type": "key", "key": "Enter" },
    { "type": "stable" },
    { "type": "key", "key": "Tab" },
    { "type": "stable" },
    { "type": "key", "key": "Tab" },
    { "type": "stable" },
    { "type": "key", "key": "a" },
    { "type": "wait", "ms": 3000 },
    { "type": "snapshot", "name": "after-a" }
]
```

Footer after `a`: `[WARN] No primary metadata available for re-discovery`.

**Live run of the new providers and UX-01**: paste `https://www.deezer.com/track/3135556 https://music.apple.com/us/album/harder-better-faster-stronger/697194953?i=697195787 https://tidal.com/track/77646168/u https://www.deezer.com/album/302127`, choose "Fetch Metadata", snapshot after 45 s (nothing has started), then press Run and snapshot at 10 s and 90 s.

**UI-03**: `examples/provider-picker.json` at `"terminal": { "cols": 80, "rows": 24 }`, stepping with `↓` and a `stable` after each key.

### A.5 Other one-liners

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://deezer.page.link/abcdef                     # DEEZER-01: 404
npx tsx src/cli.ts --version                                                                 # CLI-01: 0.2.4
echo "" | GOBLIN_DATA_DIR="$(mktemp -d)" npx tsx src/cli.ts; echo $?                         # TTY-01: one line, 1
```

---

## Appendix B: index of all findings

| ID         | Sev    | Status     | Title                                                                                 | Resolution (2026-11-22)                                                                                                                                                             |
| ---------- | ------ | ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YTDLP-01   | Medium | Reproduced | yt-dlp off, yet a discovered SoundCloud link downloads yt-dlp and the ffmpeg archive  | DONE: guarded `getTrackMetadata` / `expandCollection` / `readYtDlpInfo`; page reads use a binary-only client (no ffmpeg); a discovered link stays bare (`ProviderUnavailableError`) |
| CLAUDE-04  | Medium | Reading    | "Ask Claude" cannot be stopped; the CLI runs to its limit and spends the plan         | DONE: `DiscoveryContext.signal` down to `ClaudeClient.run`; the busy button (and `A`) stops it (`stopLastResort`); comment fixed                                                    |
| LR-01      | Low    | Reproduced | "Ask Claude" offered before the track is read, for its own platform, and does nothing | DONE: offered only once read and searched; never the track's own platform                                                                                                           |
| APPLE-01   | Low    | Reproduced | Apple's pacing queue cannot be left by a stop or a skip; 403 not backed off for all   | DONE: FIFO queue a stopped / skipped caller leaves; a 403/429 pushes the slot for everyone                                                                                          |
| DEEZER-01  | Low    | Reproduced | `deezer.page.link` is a dead host still accepted                                      | DONE: still recognised, never followed; fails with the reason                                                                                                                       |
| DEEZER-02  | Low    | To verify  | No Deezer pacing; region-blocked album tracks dropped without a word                  | DONE: 110 ms spacing, quota (code 4) waited out and retried; region-blocked tracks counted (`unavailable`)                                                                          |
| SC-01      | Low    | Reading    | `on.soundcloud.com` short link to a set imported as a track (no `resolveLink`)        | DONE: `SoundCloudService.resolveLink` (shared `followLink`)                                                                                                                         |
| YTDLP-02   | Low    | Reading    | yt-dlp page reads without `--ignore-config`, and not stopped by skip / stop           | DONE: `ignoreConfig`, and the search's signal kills the process                                                                                                                     |
| SEM-01     | Low    | To verify  | A branch still waiting when its run ends puts the stage one over its cap for a while  | DONE: reproduced by a test (peak 2), fixed with `Permit.over`                                                                                                                       |
| RESTART-01 | Low    | Reading    | Collection restart counts busy tracks before its dialog; refusal only in the footer   | DONE: counted again after the dialog, `CollectionTask.restart` refuses too, refusal in a dialog                                                                                     |
| LOCK-02    | Low    | To verify  | Empty-lock window on Linux / macOS; a suspended owner loses its lock after 5 minutes  | PARTLY DONE: (1) the lock is hard-linked into place with its pid; (2) a suspended owner still loses it after 5 min (accepted)                                                       |
| COOKIE-02  | Low    | Reading    | The imported cookies.txt keeps every site's cookies                                   | DONE: only youtube.com / google.com kept; the dialog says how many were dropped                                                                                                     |
| PICARD-01  | Low    | Reading    | Any program on port 8000 taken for Picard; a batch cannot be stopped                  | DONE: a 4xx/5xx answer is not Picard; a batch of 10+ shows a Stop dialog and logs progress                                                                                          |
| PERF-01    | Low    | Reproduced | `clipboard.writeSync` / `readSync` freeze the UI ~300 ms per copy on Windows          | DONE: `copyToClipboard` / `readClipboard` everywhere                                                                                                                                |
| UI-03      | Low    | Reproduced | Provider picker at 80×24 shows one platform at a time                                 | DONE: intro wrapped by the app (no leading space) and dropped, then the details, until every row fits                                                                               |
| UX-01      | Low    | Reproduced | "Fetch Metadata" in the import dialog does not fetch until Run (predates v0.2.4)      | DONE (wording): "Add, to tag and download" / "Add, to tag only" / "Add only" + "Nothing starts until you press Run"                                                                 |
| QUOTA-01   | Low    | Reading    | Plan-usage file: fixed temp name, unserialised saves, no Windows rename retry         | DONE: saves serialised, unique temp name, `renameReplacing`                                                                                                                         |
| DOC-03     | Low    | Reading    | CLAUDE.md / TODO.md / ARCHITECTURE.md still describe v0.2.3; stale comments           | DONE: CLAUDE.md, TODO.md, ARCHITECTURE.md, the `rediscoverPart` and `answerPatch` comments                                                                                          |

End of document.
