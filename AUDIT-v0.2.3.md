# Goblin Malin, full code audit (v0.2.3, commit `06347e3`)

Audit date: 2026-11-16. Repository: `Tetraxel/goblin-malin`, branch state at commit `06347e3` ("feat: group tracks by hand (Ctrl+G), with the fixes from its review").

Nothing was committed, pushed or sent to the repository. The working tree is unchanged (`git status` is clean). All scratch files (repro scripts, TUI scenarios, this document) live outside the repository.

---

## Table of contents

- [Goblin Malin, full code audit (v0.2.3, commit `06347e3`)](#goblin-malin-full-code-audit-v023-commit-06347e3)
    - [Table of contents](#table-of-contents)
    - [1. How to read this document](#1-how-to-read-this-document)
    - [2. Executive summary](#2-executive-summary)
        - [Counts](#counts)
        - [The nine things I would fix first](#the-nine-things-i-would-fix-first)
        - [General impressions](#general-impressions)
    - [3. What was done, and what was not](#3-what-was-done-and-what-was-not)
        - [Done](#done)
        - [Not done, so the absence of findings there means nothing](#not-done-so-the-absence-of-findings-there-means-nothing)
    - [4. Baseline: the project's own checks](#4-baseline-the-projects-own-checks)
    - [5. Findings, high severity](#5-findings-high-severity)
        - [🟢 DONE DATA-01. One `R` keypress erases a finished track's metadata, sources and the user's edits, without confirmation](#-done-data-01-one-r-keypress-erases-a-finished-tracks-metadata-sources-and-the-users-edits-without-confirmation)
        - [🟢 DONE DATA-02. `R` on an album or playlist deletes all its tracks, without confirmation](#-done-data-02-r-on-an-album-or-playlist-deletes-all-its-tracks-without-confirmation)
        - [🟢 DONE DATA-03. Three reset paths wipe `metadataOverride`, which the project's own rules call user data](#-done-data-03-three-reset-paths-wipe-metadataoverride-which-the-projects-own-rules-call-user-data)
        - [🟢 DONE TAG-01. M4A files are tagged in a form most software cannot read](#-done-tag-01-m4a-files-are-tagged-in-a-form-most-software-cannot-read)
        - [🟢 DONE DL-01. A YouTube link with a `list=` parameter makes yt-dlp process the playlist, not the track](#-done-dl-01-a-youtube-link-with-a-list-parameter-makes-yt-dlp-process-the-playlist-not-the-track)
        - [🟢 DONE CRED-01. Secrets with special characters are saved to `.env` raw, and read back truncated](#-done-cred-01-secrets-with-special-characters-are-saved-to-env-raw-and-read-back-truncated)
        - [🟢 DONE RUN-01. Opening another session during "Run all" starts that session's tasks and abandons the first run](#-done-run-01-opening-another-session-during-run-all-starts-that-sessions-tasks-and-abandons-the-first-run)
        - [🟢 DONE BIN-01. Tool updates are not transactional: a failed update removes the working tool, a killed download leaves a trusted broken one](#-done-bin-01-tool-updates-are-not-transactional-a-failed-update-removes-the-working-tool-a-killed-download-leaves-a-trusted-broken-one)
        - [🟢 DONE SET-01. A failed settings write is invisible: no message on screen and nothing in the log](#-done-set-01-a-failed-settings-write-is-invisible-no-message-on-screen-and-nothing-in-the-log)
    - [6. Findings, medium severity](#6-findings-medium-severity)
        - [🟢 DONE RUN-02. After reopening a session, "Run all" stamps "Queued" on tasks that are already finished](#-done-run-02-after-reopening-a-session-run-all-stamps-queued-on-tasks-that-are-already-finished)
        - [🟢 DONE RUN-03. Removing a running task leaves it running, detached](#-done-run-03-removing-a-running-task-leaves-it-running-detached)
        - [🟢 DONE RUN-04. "Stop" does not interrupt the metadata stage, and several ways of running a track cannot be stopped at all](#-done-run-04-stop-does-not-interrupt-the-metadata-stage-and-several-ways-of-running-a-track-cannot-be-stopped-at-all)
        - [🟢 DONE NET-01. Provider calls have no timeout](#-done-net-01-provider-calls-have-no-timeout)
        - [🟢 DONE SLSK-01. Any failed Soulseek search destroys the connection shared by all tasks](#-done-slsk-01-any-failed-soulseek-search-destroys-the-connection-shared-by-all-tasks)
        - [🟢 DONE SLSK-02. Each Soulseek search first deletes earlier downloads of the same track, whoever still uses them](#-done-slsk-02-each-soulseek-search-first-deletes-earlier-downloads-of-the-same-track-whoever-still-uses-them)
        - [🟢 DONE RANK-01. Soulseek ranking triples the score of "extended" files even when the track wanted is not an extended version](#-done-rank-01-soulseek-ranking-triples-the-score-of-extended-files-even-when-the-track-wanted-is-not-an-extended-version)
        - [🟢 DONE RANK-02. Peers that report a speed of 0 are silently discarded](#-done-rank-02-peers-that-report-a-speed-of-0-are-silently-discarded)
        - [🟢 DONE RANK-03. The Soulseek query is the full streaming title, with no relaxed retry](#-done-rank-03-the-soulseek-query-is-the-full-streaming-title-with-no-relaxed-retry)
        - [🟢 DONE FILE-01. Windows device names are accepted as file names](#-done-file-01-windows-device-names-are-accepted-as-file-names)
        - [🟢 DONE FILE-02. Two saves to the same destination share one staging file](#-done-file-02-two-saves-to-the-same-destination-share-one-staging-file)
        - [🟢 DONE TAG-02. Retagging drops the embedded cover art for Ogg, Opus and M4A](#-done-tag-02-retagging-drops-the-embedded-cover-art-for-ogg-opus-and-m4a)
        - [🟢 DONE TAG-03. Re-saving tags the library file in place, synchronously for FLAC](#-done-tag-03-re-saving-tags-the-library-file-in-place-synchronously-for-flac)
        - [🟢 DONE DL-02. The end of a download run overrides the selection the user made during it](#-done-dl-02-the-end-of-a-download-run-overrides-the-selection-the-user-made-during-it)
        - [🟢 DONE DL-03. In-flight download rows are addressed by position](#-done-dl-03-in-flight-download-rows-are-addressed-by-position)
        - [🟢 DONE BIN-02. ffmpeg is a nightly "master" build from a third-party repository, re-downloaded whenever it is republished](#-done-bin-02-ffmpeg-is-a-nightly-master-build-from-a-third-party-repository-re-downloaded-whenever-it-is-republished)
        - [🟢 DONE BIN-03. The 200 MB ffmpeg archive is read and extracted synchronously](#-done-bin-03-the-200-mb-ffmpeg-archive-is-read-and-extracted-synchronously)
        - [🟢 DONE CRED-02. The `.env` file is world-readable, written non-atomically, and edited with read-modify-write](#-done-cred-02-the-env-file-is-world-readable-written-non-atomically-and-edited-with-read-modify-write)
        - [🟢 DONE LOCK-01. A stale lock whose pid now belongs to another program keeps the app from starting](#-done-lock-01-a-stale-lock-whose-pid-now-belongs-to-another-program-keeps-the-app-from-starting)
        - [🟢 DONE TTY-01. Started without a terminal, the app shows a React "Too many re-renders" error and never exits](#-done-tty-01-started-without-a-terminal-the-app-shows-a-react-too-many-re-renders-error-and-never-exits)
        - [🟢 DONE CACHE-01. The API cache hands out shared objects, changes their types across restarts, and never shrinks](#-done-cache-01-the-api-cache-hands-out-shared-objects-changes-their-types-across-restarts-and-never-shrinks)
        - [🟢 DONE SET-02. Pressing Esc in a setup wizard switches the provider off for good](#-done-set-02-pressing-esc-in-a-setup-wizard-switches-the-provider-off-for-good)
        - [🟢 DONE CLAUDE-01. A broad pattern can mistake an ordinary failure for "quota reached" and block Claude for ten minutes](#-done-claude-01-a-broad-pattern-can-mistake-an-ordinary-failure-for-quota-reached-and-block-claude-for-ten-minutes)
        - [🟢 DONE UI-01. The task action bar is cut at the right edge; the last actions cannot be seen](#-done-ui-01-the-task-action-bar-is-cut-at-the-right-edge-the-last-actions-cannot-be-seen)
    - [7. Findings, low severity and hardening](#7-findings-low-severity-and-hardening)
        - [Data and sessions](#data-and-sessions)
        - [Running](#running)
        - [Downloads](#downloads)
        - [Soulseek](#soulseek)
        - [Tags](#tags)
        - [Exit, update, CLI](#exit-update-cli)
        - [Claude and the agent](#claude-and-the-agent)
        - [Other](#other)
    - [8. Security review, by attack surface](#8-security-review-by-attack-surface)
        - [8.1 Process spawning](#81-process-spawning)
        - [8.2 Downloaded executables](#82-downloaded-executables)
        - [8.3 Files from strangers](#83-files-from-strangers)
        - [8.4 Local HTTP servers](#84-local-http-servers)
        - [8.5 The chat agent](#85-the-chat-agent)
        - [8.6 Secrets at rest and in memory](#86-secrets-at-rest-and-in-memory)
        - [8.7 Outbound requests](#87-outbound-requests)
    - [9. Performance review](#9-performance-review)
        - [Measured](#measured)
        - [Found by reading (all are blocking calls on the UI thread)](#found-by-reading-all-are-blocking-calls-on-the-ui-thread)
        - [Not measured](#not-measured)
    - [10. Code quality, rules of CLAUDE.md, dead code](#10-code-quality-rules-of-claudemd-dead-code)
        - [Rules that hold](#rules-that-hold)
        - [Rules that are broken](#rules-that-are-broken)
        - [Dead or duplicated code](#dead-or-duplicated-code)
    - [11. Tests, CI, documentation](#11-tests-ci-documentation)
    - [12. Things checked and found correct](#12-things-checked-and-found-correct)
    - [13. Suggested order of work](#13-suggested-order-of-work)
    - [Appendix A: reproduction scripts](#appendix-a-reproduction-scripts)
        - [A.1 `r1_env.ts` (CRED-01, CRED-02)](#a1-r1_envts-cred-01-cred-02)
        - [A.2 `r2_task.ts` (DATA-03, RANK-01, RANK-02, FILE-01, SET-01)](#a2-r2_taskts-data-03-rank-01-rank-02-file-01-set-01)
        - [A.3 `r3_ytdlp.mjs` (DL-01, DL-07, DL-08)](#a3-r3_ytdlpmjs-dl-01-dl-07-dl-08)
        - [A.4 `r4_orch.ts` (RUN-01, RUN-02)](#a4-r4_orchts-run-01-run-02)
        - [A.5 ffmpeg experiments (TAG-01, TAG-02)](#a5-ffmpeg-experiments-tag-01-tag-02)
        - [A.6 TUI scenarios (run with `yarn tsx scripts/tui-test/cli.ts <file>`)](#a6-tui-scenarios-run-with-yarn-tsx-scriptstui-testclits-file)
    - [Appendix B: index of all findings](#appendix-b-index-of-all-findings)

---

## 1. How to read this document

Every finding has:

- an **ID** (area prefix + number), stable so it can be referenced from `TODO.md`;
- a **severity**: High (data loss, wrong output, broken promise of the product, or a security problem with a realistic path), Medium (real bug or risk with a narrower trigger), Low (edge case, hardening, polish);
- a **status**:
    - **Reproduced**: I ran it and saw it happen (script or live TUI run, both described);
    - **Confirmed by reading**: the code path is unambiguous, but I did not execute it (usually because it needs the network, Windows, or a real account);
    - **To verify**: plausible from the code, needs a check on a real machine;
- the **location** as `file:line` (lines are those of commit `06347e3`);
- the **impact** in user terms and a **suggested fix**.

Findings that were already listed in `AUDIT-v0.2.1.md` or `TODO.md` are only repeated when I have something new to add, and are marked "(known)".

---

## 2. Executive summary

The project is in much better shape than most apps of this size: strict typing passes, 1,183 tests pass, persistence is atomic and defensive, the agent (chat) surface is carefully locked down, and the rendering path has clearly been measured and tuned. The findings below are therefore mostly about **behaviour at the edges of the pipeline**, where one keypress or one unusual input produces a wrong file or loses the user's work.

### Counts

| Severity  | Count  | Reproduced | Confirmed by reading | To verify |
| --------- | ------ | ---------- | -------------------- | --------- |
| High      | 9      | 7          | 2                    | 0         |
| Medium    | 24     | 9          | 15                   | 0         |
| Low       | 45     | 4          | 38                   | 3         |
| **Total** | **78** | **20**     | **55**               | **3**     |

### The nine things I would fix first

| ID              | One line                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 DONE DATA-01 | One `R` keypress on a finished track erases its metadata, download rows and the user's hand-typed overrides, with no confirmation and no undo                          |
| 🟢 DONE DATA-02 | Pressing `R` on an album or playlist deletes all of its tracks (not archived), with no confirmation                                                                    |
| 🟢 DONE DATA-03 | "Stopped, then start" and "Run selected" also wipe the user's overrides, which `CLAUDE.md` says must never happen                                                      |
| 🟢 DONE TAG-01  | M4A output: the tags are written in a form that Picard, beets, iTunes and most players cannot read (the file looks untagged)                                           |
| 🟢 DONE DL-01   | A YouTube link copied from a playlist (`&list=...`) makes yt-dlp process the whole playlist, and can save the wrong audio under the right name                         |
| 🟢 DONE CRED-01 | A password or secret containing `#`, quotes, backticks or surrounding spaces is saved to `.env` in a way that is read back truncated on the next launch                |
| 🟢 DONE RUN-01  | Opening another session while "Run all" is going starts the newly opened session's pending tasks by itself, and drops the rest of the first run                        |
| 🟢 DONE BIN-01  | A failed tool update deletes the working ffmpeg / yt-dlp first, and a download interrupted by a kill leaves a truncated binary that is then trusted forever            |
| 🟢 DONE SET-01  | When `settings.json` cannot be written, "Save & Exit" does nothing visible: no message, and nothing in `app.log` either (errors from key handlers never reach the log) |

### General impressions

- **Strong points**: the data-file layer (`dataFile.ts`, `sessionStore.ts`), the agent tool registry and MCP server, the seed server for MusicBrainz, the temp-file clean-up logic, shell-free process spawning everywhere it matters, and the performance work (2,000 tasks stay around 10 to 20 ms of React time per key in the dev profile).
- **Weak points**: destructive actions bound to single keys without confirmation; three separate code paths that reset a track and each forget that `metadataOverride` is user data; "Stop" that cannot interrupt the metadata stage; tool downloads that are not transactional; provider calls with no timeout; and a few places where a remote or user string reaches a file name or a child process with less checking than the rest of the code.

---

## 3. What was done, and what was not

### Done

- Read in full or in large part: entry points (`cli.ts`, `index.tsx`), persistence (`settingsStore.ts`, `sessionStore.ts`, `sessionManager.ts`, `dataFile.ts`, `instanceLock.ts`, `exitApp.ts`), credentials (`env.ts`, `envFile.ts`), the task engine (`task.ts`, `orchestrator.ts`, `runController.ts`), the pipeline (`downloadTask.ts` almost entirely, `collectionTask.ts`), both download providers (`YtDlpService.ts`, `SoulseekService.ts`, `ranking.ts`), the YouTube metadata service, the save path (`computeOutputPath.ts`, `fileName.ts`, `cleanOutputDir.ts`, `writeViaStaging.ts`, `tagAudioFile.ts`, `utils/metadata.ts`, `convertAudio.ts`, `ffmpegRun.ts`), temp files (`tempFile.ts`, `tempDownloads.ts`, `tempCleanup.ts`), tool downloads (`ffmpeg-setup.ts`, `ffmpegBuilds.ts`, `binaryArchive.ts`, `checksum.ts`, `ytdlp-setup.ts`, parts of `mpv-setup.ts`), HTTP and cache (`http.ts`, `cache.ts`), both Claude clients, the agent core (`mcpServer.ts`, `agentToolRegistry.ts`, `agentTurn.ts`, `jsonSchema.ts`, `taskAccess.ts`, `taskLock.ts`, `agentRuntime.ts`, `settingsView.ts`), the MusicBrainz seed server, the updater, the logger, the shortcut registry and dispatcher, the contextual actions, CI and release workflows.
- Ran the project's own checks: type-check, lint, prettier, UTF-8 check, the full Vitest suite, `yarn audit`.
- Wrote and ran four reproduction scripts and several live TUI scenarios through the project's own headless harness (`scripts/tui-test`), plus direct ffmpeg / ffprobe / mutagen experiments to check what the tag writer really produces.
- Ran the 2,000-task render profile.

### Not done, so the absence of findings there means nothing

- **No live network run.** The sandbox blocks YouTube, MusicBrainz, Songlink, Spotify and the GitHub API. No real download, no real Soulseek session, no real Claude CLI call was made. Everything about those paths is from reading the code, from the argument lists the code builds, and from local experiments with the same tools.
- **No Windows or macOS run.** Everything ran on Linux. Windows-specific behaviour (reserved file names, `.cmd` shims, named pipes, file locking) is from reading.
- Only skimmed: `SpotifyService.ts`, the Songlink and MusicBrainz clients, the MusicBrainz identity resolver (`musicbrainz/*.ts` except the seed server), the agent's music tools (`agent/tools/*.ts`), the chat panel, the welcome tour and its audio, most React components, `groupTasks.ts`, the archive modal, the profiling code.
- No fuzzing of URL parsing or of the session file loader.

---

## 4. Baseline: the project's own checks

| Check                    | Result                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `yarn type-check`        | Passes (both `src/` and the TUI harness project)                                                                   |
| `yarn lint`              | 0 errors, **25 warnings** (all `no-explicit-any` in `tests/`). `AUDIT-v0.2.1.md` states "0 warnings": it drifted   |
| `yarn format:check`      | Passes                                                                                                             |
| `yarn check:utf8`        | Passes (644 files). Note: 63 source files start with a UTF-8 BOM and the others do not, see QUAL-06                |
| `yarn test` (Vitest)     | **104 files passed, 1 skipped; 1,183 tests passed, 11 skipped**, 47 s, on Linux                                    |
| `yarn audit` (prod deps) | 1 high advisory: `zod` through `ytmusic-api` (known, DEP-02 in the previous audit; patched in zod 4.6.6 and later) |

Two remarks:

- `TODO.md` still says "Get the unit tests green on Linux CI, then enable them there (they only run on Windows now)". They pass on Linux here, and `ci.yml` already has `ubuntu-latest` in its matrix. The TODO entry is stale (DOC-02).
- The end-to-end tests (`tests/e2e`) are not run in CI: `ci.yml` runs `npx vitest run tests/unit --coverage` only (TEST-01).

---

## 5. Findings, high severity

### 🟢 DONE DATA-01. One `R` keypress erases a finished track's metadata, sources and the user's edits, without confirmation

- **Status**: Reproduced (live TUI run and script).
- **Where**: `src/flows/musicDownloadFlow/contextualActions.ts:251-260` (the `runTask` helper bound to `R`), `src/flows/musicDownloadFlow/utils/downloadTask.ts:1427-1445` (`restart()`).
- **What happens**: on a track whose state is anything but pending or stopped, `R` ("Restart") calls `t.restart()` directly. `restart()` immediately sets `metadataGroups: []`, `metadataOverride: {}`, `downloadSources: []` and then calls `start()`. There is no confirmation dialog, although deleting a task has one. The restart is wrapped in `runWithoutCache`, so nothing comes back from the cache either.
- **Live run**: fixture `50-tasks-with-metadata`, `Tab` to the list, press `r` once. Within 1.5 s the row for "NOTION, Hooked" has empty ARTIST, TRACK, SPOTIFY and YOUTUBE cells and a Spotify setup wizard is on screen. The SONGLINK and MB cells still show their old check marks (see DATA-07), so the row is now inconsistent.
- **Why it matters**:
    - The key is a lower-case letter next to keys the user presses all the time (`F`, `D`, `W`, `S`). A slip destroys the work on that track: metadata picked source by source, hand-typed title and artist corrections, the list of downloaded candidates.
    - Offline, or when a provider is down, the track cannot be rebuilt at all: the data is gone and the refetch fails.
    - With a multi-selection, `onClickBatch` applies it to every selected track.
    - The temporary files of the erased download rows stay on disk as orphans until the next clean-up.
    - `restart()` is started with `fire(...)`, not through the orchestrator: it ignores the global concurrency cap and has no abort signal, so "Stop" does not stop it (see RUN-04).
- **Suggested fix**: (1) keep `metadataOverride` across every reset (see DATA-03), (2) ask before restarting a track that has overrides, user sources, downloaded rows or a saved file (the `deleteConfirmBridge` pattern already exists), (3) route the restart through `runSelected` so it gets the cap and the stop signal, (4) consider keeping the previous groups on screen until the new ones arrive instead of blanking first.

### 🟢 DONE DATA-02. `R` on an album or playlist deletes all its tracks, without confirmation

- **Status**: Confirmed by reading.
- **Where**: `src/flows/musicDownloadFlow/contextualActions.ts:603` (`c.restart()` for a collection that has been run), `src/flows/musicDownloadFlow/utils/collectionTask.ts`, method `restart()` (`TaskOrchestrator.getInstance().removeTasks(attrs.childTaskIds)`).
- **What happens**: restarting a collection removes every child task from the queue (removed, not archived) and then refetches the track list. Each child's overrides, user-added links, download rows and saved-file record are gone. Children that are running keep running detached (see RUN-03).
- **Why it matters**: for a 60-track playlist the user has been working through, one key undoes everything. The archive exists precisely so that removal is reversible, but this path bypasses it.
- **Suggested fix**: confirm first, and either archive the children or keep them and only refetch the list (the existing `refetch()` already does the non-destructive version).

### 🟢 DONE DATA-03. Three reset paths wipe `metadataOverride`, which the project's own rules call user data

- **Status**: Reproduced (script `r2_task.ts`, appendix A).
- **Where**:
    - `src/flows/musicDownloadFlow/utils/downloadTask.ts:287-296` (`start()` from the "stopped" state),
    - `src/flows/musicDownloadFlow/utils/downloadTask.ts:1433-1444` (`restart()`),
    - `src/flows/musicDownloadFlow/runController.ts:108-116` (`runSelected()` on a finished or failed track).
- **Evidence** (output of the script):

    ```
    [1] override typed by the user  : {"trackName":"Song","artists":[{"type":"artist","name":"Real Artist"}]}
    [1] after stopped -> start      : {} | filename override kept: My name.flac
    [1] after restart               : {}
    ```

- **Why it matters**: `CLAUDE.md` has a whole section, "User data is never rebuilt away", that names exactly these events ("restart, re-discovery and stopped then start") and requires hand-entered data to live outside what the pipeline rebuilds. `userSources` follows the rule and has a test (`tests/unit/userSources.test.ts`). `metadataOverride` is the same kind of data (what the user typed over the sources' values) and is explicitly reset to `{}` in three places. `outputFilenameOverride` and `outputDirOverride` survive, so the behaviour is not even consistent between the user's own fields.
- The most surprising case is "stopped then start": the user stops a long download, fixes the title while waiting, presses Run again, and the fix is gone.
- **Suggested fix**: remove `metadataOverride: {}` from the three resets and add the same kind of test `userSources` has. If a "start from nothing" action is wanted, make it a separate, confirmed action.

### 🟢 DONE TAG-01. M4A files are tagged in a form most software cannot read

- **Status**: Reproduced with the exact ffmpeg arguments the app builds, checked with ffprobe and mutagen.
- **Where**: `src/flows/musicDownloadFlow/utils/tagAudioFile.ts:113-115` (`-movflags use_metadata_tags`).
- **What happens**: for `.m4a`, `tagWithFfmpeg` adds `-movflags use_metadata_tags` so that ISRC, BPM and the MusicBrainz ids are not dropped by the MP4 muxer. That flag makes ffmpeg write **all** tags as `mdta` key/value pairs instead of the iTunes-style `ilst` atoms (`©nam`, `©ART`, `©alb`...). ffmpeg and ffprobe read both forms, which is why it looks fine from inside the app. Almost nothing else does.
- **Evidence**:

    ```
    after the app's tagging command, raw atom counts in the file:
      ©nam 0   ©ART 0   ©alb 0   mdta 6   keys 1
    mutagen (the library behind Picard, beets, Quod Libet) reads:
      {'\x00\x00\x00\x01': ['My Title'], '\x00\x00\x00\x02': ['My Artist'], '\x00\x00\x00\x03': ['My Album'], ...}
    same command without the flag:
      {'©nam': ['My Title'], '©ART': ['My Artist'], ...}   (ISRC dropped)
    ```

- **Why it matters**: "M4A" is one of the five output formats offered in Settings, and tagging is the product's main promise. A saved M4A shows as untitled in iTunes / Apple Music, in file managers, on phones and in MusicBrainz Picard, which is where the app sends users for the MusicBrainz step.
- **Suggested fix**: drop `use_metadata_tags`; write the standard atoms through ffmpeg (title, artist, album_artist, album, date, track, genre) and add the non-standard ones as iTunes freeform atoms (`----:com.apple.iTunes:ISRC`, `MusicBrainz Track Id`...). ffmpeg cannot write freeform atoms itself, so either accept losing them for M4A and say so, or use a small MP4 tag writer for that format. Add a unit test that reads the result back with something other than ffmpeg.

### 🟢 DONE DL-01. A YouTube link with a `list=` parameter makes yt-dlp process the playlist, not the track

- **Status**: Reproduced as far as the argument list; the yt-dlp behaviour for such URLs is documented and well known. Not run against YouTube (network blocked).
- **Where**: `src/flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService.ts:277` (the track's `url` is the raw link the user pasted), `src/flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService.ts:94` and `:220` (that `url` is handed to yt-dlp), and the options at `:191-199` (no `noPlaylist`).
- **Evidence**: arguments built by the app's own call for the link `https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz123&index=7`:

    ```
    --js-runtime node --paths <tmp> -o "YtDlp YOUTUBE-TRACK-dQw4w9WgXcQ <uuid>.flac" --restrict-filenames
    --extract-audio --audio-format flac --ffmpeg-location ... -- https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz123&index=7
    has --no-playlist: false
    ```

- **What happens**: `parseUrl` correctly extracts `v=`, so the metadata is that of the right video. But yt-dlp, given a watch URL that also carries `list=`, treats it as the playlist unless told `--no-playlist`. The output template is a fixed file name, so yt-dlp downloads the **first item of the playlist** into it and then walks the rest of the list (each later item is skipped as "already downloaded", after its page has been fetched).
- **Why it matters**: links copied from the address bar while a playlist or a mix is playing are extremely common (`&list=PL...`, `&list=RD...`, `&start_radio=1`). The task then saves the first video of the playlist under the title and tags of the requested one, and takes as long as the playlist is long. The wrong file is also cached by track id (`findExistingTempFile`), so a retry reuses it.
- **Suggested fix**: build the download URL from the id (`YoutubeService.trackUrl(song.videoId)`, which already exists) instead of reusing the pasted link, and pass `noPlaylist: true` as a second barrier. Also consider `--ignore-config` so the user's own yt-dlp config file cannot change the output template or format (DL-07), and a size or duration limit (DL-08).

### 🟢 DONE CRED-01. Secrets with special characters are saved to `.env` raw, and read back truncated

- **Status**: Reproduced (script `r1_env.ts`).
- **Where**: `src/utils/envFile.ts:5-22` (`saveEnvVar`) and `:84-128` (`saveEnvVarsGroup`), both write `KEY=value` with no quoting. Callers: `src/base/env.ts` (setup wizards for Spotify and Soulseek).
- **Evidence** (value typed in the wizard, then value dotenv returns at the next launch):

    ```
    "abc#123"            -> "abc"
    "p@ss #word"         -> "p@ss"
    "\"quoted\""         -> "quoted"
    "  padded  "         -> "padded"
    "`x`"                -> "x"
    "line1\nINJECTED=1"  -> "line1"   (and a new variable INJECTED=1 exists)
    ```

- **Why it matters**: during the session where the value is typed, the app uses the in-memory value, so everything works. After a restart, the credential is different. For Soulseek this is nasty: the wizard tells the user "any username/password works, an account is created automatically", so the first login creates the account with the real password, and every later launch logs in with a truncated one and fails. The user has no hint that the stored value changed. A pasted value with a line break can also define another variable in the app's environment.
- **Suggested fix**: write values double-quoted with `\`, `"` and newlines escaped (dotenv's own format), reject control characters, and add a round-trip test (`save` then `dotenv.parse`) over a list of hostile values.

### 🟢 DONE RUN-01. Opening another session during "Run all" starts that session's tasks and abandons the first run

- **Status**: Reproduced (script `r4_orch.ts`).
- **Where**: `src/base/task/orchestrator.ts:74-79` (`setTasks`), `:199-223` (the pump reads `this.tasks` every time a slot frees), `src/sessions/sessionManager.ts:69-101` (`loadSession`), `:186-191` (`newSession`), `:193-209` (`duplicateSession`), `:211-221` (`deleteSession`). The Sessions modal has no "a run is in progress" guard (`src/components/SessionsModal/SessionsModal.tsx:65`, `:99`, `:222`, `:234`).
- **Evidence**: concurrency 1, session A has pending tasks A1, A2, A3; "Run all"; 50 ms later the task list is replaced by session B (B1, B2 pending):

    ```
    tasks started, in order: A1, B1, B2
    session B tasks states  : B1=finished, B2=finished
    ```

- **What happens**:
    - The pump is still alive (its `processing` flag is true until it settles). When A1 finishes, it asks for candidates and gets them from the _new_ list, so session B's pending tasks start although the user never pressed Run there.
    - A2 and A3 are silently dropped from the run.
    - A1 (and any other in-flight task of session A) keeps running detached from every list. What it downloads is never saved to a session; its temporary files become orphans.
    - `setTasks` clears `removingTasks`, so the detached tasks no longer count against the concurrency cap.
    - The same happens with "New session", "Duplicate" and deleting the current session, and with a collection that finishes fetching after the switch (`fetchAndSpawn` adds its children to whatever list is current).
- **Suggested fix**: in `SessionManager`, refuse (or ask to stop first) while `orchestrator.isProcessing()` or any task has `running` / `partRunning`; and make `setTasks` abort the current batch. A lighter variant: bind a batch to the task list it started with.

### 🟢 DONE BIN-01. Tool updates are not transactional: a failed update removes the working tool, a killed download leaves a trusted broken one

- **Status**: Confirmed by reading (both parts are plain control flow).
- **Where**: `src/utils/ffmpeg-setup.ts:64-66` (`cleanupOldVersions` then `source.install`), `src/flows/musicDownloadFlow/services/download-providers/ytdlp/ytdlp-setup.ts` (`cleanupOldVersions("yt-dlp_", binaryName)` followed by `downloadFile(..., binaryPath)` straight to the final name), same pattern in `ffprobe-setup.ts`.
- **Part 1, old version deleted first**: when a newer release exists, the old binaries are deleted _before_ the new one is downloaded and verified. If the download then fails (connection drop in a 200 MB archive, GitHub asset being replaced, checksum mismatch, disk full), the fallback `findExistingBinary` finds nothing and the user has no ffmpeg or yt-dlp at all, where a minute earlier they had a working one. On Windows a binary in use cannot be deleted, which hides the problem there some of the time.
- **Part 2, partial file at the final path**: yt-dlp is downloaded directly to `bin/yt-dlp_<version>`. `downloadFile` removes the partial file when the _request_ fails, but not when the _process_ is killed, the machine sleeps, or the terminal is closed mid-download. On the next start `fs.access(binaryPath)` succeeds, the log says "already installed", and the truncated file is used. The checksum is only verified right after a download, never when a file is reused, so this state lasts until the next upstream release.
- **Suggested fix**: download to `<name>.part` in the same folder, verify, `chmod`, then rename to the final name; only then delete older versions. The archive path (`binaryArchive.ts`) already extracts then renames, so only the order of clean-up needs to change there.

### 🟢 DONE SET-01. A failed settings write is invisible: no message on screen and nothing in the log

- **Status**: Reproduced (script, then live TUI run with a settings file that cannot be written).
- **Where**: `src/settings/settingsStore.ts:160-175` (`writeToDisk`: synchronous `mkdirSync` / `writeFileSync` / `renameSync`, no error handling, memory and listeners updated before the write), `src/components/SettingsModal/SettingsModal.tsx:138-144` (`commitAndExit`), `src/base/shortcuts/ShortcutRegistry.ts:190-196` (`runHandler` catches and calls `console.error`), `src/cli.ts:17-19` together with `src/index.tsx:114` (`patchConsole: true`).
- **Live run**: data folder where `settings.json.tmp` cannot be created (stands for a full disk, a read-only folder, a file locked by a sync tool). Open Settings, toggle "Show welcome tutorial", press `Ctrl+S` ("Save & Exit"). Result: the modal stays open, no message appears, `settings.json` on disk is unchanged, and `app.log` contains only the boot line. The toggle looks applied for the rest of the session and silently reverts at the next launch.
- **Two bugs in one**:
    1. `SettingsStore` updates its in-memory copy and notifies listeners _before_ writing, then throws. Every caller (`patchMusicSettings` is called from consent, the agent, clean-up, collections, the setup wizard) either crashes its handler or carries on believing the value was stored. `SessionStore` handles the same situation properly (retry, user notice after three failures); `SettingsStore` has none of that.
    2. The error never reaches the log. `ShortcutRegistry.runHandler` reports handler errors with `console.error`. `cli.ts` redirects `console.*` to the logger, but it does so _before_ `render(..., { patchConsole: true })`, and Ink then replaces the console methods with its own. So every "unhandled error in <shortcut>" message is lost. In addition, `void entry.handler()` means an async handler's rejection only shows up as an anonymous "Unhandled Rejection".
- **Suggested fix**: catch in `writeToDisk`, report through `dataFileNoticeBridge` like the sessions store does, and keep a "dirty" flag to retry. For logging: call `globalLogger.error` directly in `runHandler` (and attach `.catch` to the handler's promise), and either set `patchConsole: false` or install the redirect after `render`.

---

## 6. Findings, medium severity

### 🟢 DONE RUN-02. After reopening a session, "Run all" stamps "Queued" on tasks that are already finished

- **Status**: Reproduced (script `r4_orch.ts`, part b).
- **Where**: `src/base/task/task.ts` (`running`, `finishedAt`, `runnedAt`, `attempt`, `success` are plain instance fields, not part of the snapshot), `src/base/task/orchestrator.ts:103-105` (`getTasksCandidates` = not running and `finishedAt` undefined), `src/flows/musicDownloadFlow/runController.ts:24-32`.
- **What happens**: `finishedAt` is not saved, so after a session is reopened every task, including the finished ones, is a "candidate". `runAll()` sets the status "Queued" on all candidates. The finished ones are then started, return at once ("already processed") without touching their status, and stay "Queued".
- **Evidence**: `F1:finished:"Queued" | F2:finished:"Queued"` where both had the status "Saved" before.
- **Impact**: the status column, which is what the user reads to know what is saved, is overwritten for the whole list by one "Run all" on a session that has a single pending track. Each of those tasks also takes a slot and a `start()` call for nothing (2,000 no-op starts on a big session).
- **Fix**: derive candidacy from `attributes.state` (pending or stopped) instead of the unsaved `finishedAt`, or restore `finishedAt` when a snapshot of a finished task is revived.

### 🟢 DONE RUN-03. Removing a running task leaves it running, detached

- **Status**: Confirmed by reading.
- **Where**: `src/base/task/orchestrator.ts:90-101` (`removeTasks`), `src/flows/musicDownloadFlow/contextualActions.ts:293`, `:299`, `:686`, `:694` (Delete), `src/flows/musicDownloadFlow/utils/collectionTask.ts` (`restart`).
- **What happens**: "Delete" (the permanent choice of the Archive / Delete dialog) removes the task from the list but does not abort it. The orchestrator deliberately keeps its slot (`removingTasks`), so the work continues: metadata calls, yt-dlp, Soulseek transfers. Nothing can stop it any more (it is in no list), its result is discarded, and its temp files are orphans. `archiveTasks` refuses running tasks; `removeTasks` does not.
- **Fix**: abort the task (per-task `AbortController`) when it is removed, or refuse to delete a running task the way archive does.
- **Done**: Delete skips a busy task, as Archive does (`Task.isBusy()`). Not done: `CollectionTask.restart()` still removes its tracks without checking whether one is running (see RUN-04).

### 🟢 DONE RUN-04. "Stop" does not interrupt the metadata stage, and several ways of running a track cannot be stopped at all

- **Status**: Confirmed by reading.
- **Where**: `src/flows/musicDownloadFlow/utils/downloadTask.ts:308-316` (`startPrimaryMetadataFetching()` and `startMetadataDiscovering()` are called without the signal), `:1487-1529` (`runMetadataPart`, `runDownloadPart` have no signal), `:1427-1446` (`restart` calls `this.start()` with no signal), `contextualActions.ts:257-259` (`fire(t.restart())`, `fire(t.start())`).
- **What happens**:
    - In a batch, the abort signal is only checked between stages. A track in discovery finishes every provider call first, including the last-resort Claude call (up to 180 s by its own timeout) and the MusicBrainz identity check (rate limited, the code comments say "minutes"). "Stop" therefore appears to hang.
    - `R` / Start on one track from the list, "Re-fetch", "Re-discover" and "Download sources" run outside the orchestrator: no global concurrency cap (`maxParallelTasks` is ignored, only the stage limiters apply) and no signal. The toolbar's Stop does nothing for them.
- **Fix**: thread the signal through the two metadata methods (the skip mechanism in `startMetadataDiscovering` already accepts one), give every `DownloadTask` its own controller that Stop and Delete can use, and start single-track runs through `runSelected`.
- **Done**: the signal reaches the metadata stage (the provider calls are waited for with `untilAborted`), every run has its own stop (`Task.abortRun`, called by Stop and by removal), and `R` with no batch going runs through `runSelected` (cap, Stop button, session guard). Not done: while a batch is going, a track started by hand runs beside it, outside the global cap (the stage limiters still apply); a part run started by hand has no toolbar Stop of its own when nothing else is running (the orchestrator's subscription does not see it).

### 🟢 DONE NET-01. Provider calls have no timeout

- **Status**: Confirmed by reading (no `timeout`, `AbortSignal` or `signal` in these files).
- **Where**: `src/flows/musicDownloadFlow/services/apis/songlink-client.ts:151` (`fetch(fullUrl)`), `services/apis/spotify-url-info-client.ts`, `services/metadata-providers/spotify/SpotifyService.ts`, `services/apis/musicbrainz-client.ts`, the `ytmusic-api` calls in `YoutubeService.ts`, and `src/utils/probeAudio.ts:45` (`execFile` of ffprobe with no timeout).
- **Impact**: a connection that stalls holds a `metadataLimiter` slot until the runtime's own limits fire (minutes for `fetch`). With `maxParallelMetadata` stalled connections the whole metadata stage stops, and because of RUN-04 the user cannot stop it. A corrupt downloaded file that makes ffprobe hang blocks that task for ever.
- **Fix**: `AbortSignal.timeout(...)` combined with the task's signal on every request; `timeout` option on `execFile`. `updateChecker.ts` already does this correctly (8 s).
- **Done**: 30 s on Songlink, Spotify (SDK and embed page), YouTube Music, 2 min on MusicBrainz (its own rate limit queues calls), 60 s on `ffprobe`. The limits are not combined with the task's signal for the providers whose clients take none: the caller stops waiting, the request ends by itself.

### 🟢 DONE SLSK-01. Any failed Soulseek search destroys the connection shared by all tasks

- **Status**: Confirmed by reading.
- **Where**: `src/flows/musicDownloadFlow/services/download-providers/soulseek/SoulseekService.ts:184-194` (`withReconnect`), `:137` (one static client for the whole app), `:225-227`.
- **What happens**: `withReconnect` treats every error from `client.search` as "the connection is dead": it calls `client.destroy()` on the shared static client and logs in again. Meanwhile other tasks may be mid-transfer on that client; their downloads fail. The search itself takes no abort signal, so a stopped task still waits for the search timeout.
- **Fix**: reconnect only on connection-level errors, and never destroy a client that has active transfers (reference count, or one client per transfer).
- **Done**: the connection is kept while any transfer runs on it (`client.downloads`), a replaced client is not destroyed twice, and a stopped task stops waiting for its search. The client does not tell connection errors from others, so "no transfer running" is the test.

### 🟢 DONE SLSK-02. Each Soulseek search first deletes earlier downloads of the same track, whoever still uses them

- **Status**: Confirmed by reading.
- **Where**: `SoulseekService.ts:337` (`deleteExistingTempFiles`), `src/flows/musicDownloadFlow/utils/tempFile.ts:91-104`.
- **What happens**: before searching, every temp file whose name starts with `Soulseek <track uri>` and ends with the extension is deleted. The match is by track, not by task or session. Files that another session, an archived task, a duplicated session (SESS-02) or this task's own saved-file record (`savedFile.downloadPath`) still point at are removed; those rows then say "File not found". With the "all" download strategy the user may have deliberately kept several candidates.
- **Fix**: delete only the files of the rows this run is about to replace (the task knows their paths), not everything matching the track.
- **Done**: only this task's own Soulseek rows are cleared, and never the file its saved-file record points at. Leftovers from a run whose rows were already reset are no longer removed here; "clear temporary downloads" handles them.

### 🟢 DONE RANK-01. Soulseek ranking triples the score of "extended" files even when the track wanted is not an extended version

- **Status**: Reproduced (script `r2_task.ts`).
- **Where**: `src/flows/musicDownloadFlow/services/download-providers/soulseek/ranking.ts:108-109`.
- **Evidence**: for the query "Artist, Song" (200 s): plain file weight 3.09, "Song (Extended Mix)" weight 9.27. "Song (Karaoke Instrumental)" gets the same 3.09 as the original.
- **Impact**: the extended or club mix is tried first. When the peer announces a duration, the 10 s tolerance rejects it before download; when it does not, the file is downloaded, measured and thrown away (wasted transfer, and up to five such attempts); when the _track's_ duration is unknown, the wrong version is kept and auto-selected.
- **Fix**: apply those bonuses only when the wanted title contains the same word, as the "remix" parity check on line 90 already does, and extend the parity check to the usual version words (live, instrumental, karaoke, acapella, edit, remaster).

### 🟢 DONE RANK-02. Peers that report a speed of 0 are silently discarded

- **Status**: Reproduced.
- **Where**: `ranking.ts:106` (`Math.log(result.speed) / 20`).
- **Evidence**: weight for `speed = 0` is `-Infinity`; `rankResults` keeps only `weight >= 0`.
- **Impact**: many Soulseek clients report 0 until they have completed an upload. Those results never appear, not even in the "show more" list, so a track can end as "No results" while valid files were returned. A file of size 0 has the same effect through `Math.log(result.size)`.
- **Fix**: `Math.log1p(Math.max(0, speed))`, same for size.

### 🟢 DONE RANK-03. The Soulseek query is the full streaming title, with no relaxed retry

- **Status**: Confirmed by reading.
- **Where**: `SoulseekService.ts:197-200` (`searchQuery`), `ranking.ts:17-23` (`cleanSearchTerm`).
- **What happens**: the query is `<first artist> <full title> .<ext>`. Soulseek requires every word to match the file path. Streaming titles carry words files rarely have: "Song - 2011 Remaster", "Song (feat. X)", "Song - Radio Edit". `cleanSearchTerm` removes some punctuation but keeps `-`, `'`, `&`, `,`, `!` and the words themselves. A leading `-` on a word is the exclusion operator in Soulseek searches.
- **Impact**: frequent "No results" for tracks that exist under a shorter name; there is no second, simpler query.
- **Fix**: strip parentheses content and " - suffix" parts for a fallback query, drop `feat.` clauses, remove a leading `-` from words.

### 🟢 DONE FILE-01. Windows device names are accepted as file names

- **Status**: Reproduced for the name computation; the effect on Windows is from reading.
- **Where**: `src/flows/musicDownloadFlow/utils/fileName.ts:28-35` (`sanitizeFileNamePart`), `utils/cleanOutputDir.ts:97-110` (`cleanOutputFilename`).
- **Evidence**: `cleanOutputFilename("NUL")` gives `"NUL.flac"`; same for `con`, `aux`, `COM1`, `LPT1`. Also `".hidden"` gives `".hidden.flac"`, and a name containing the right-to-left override character U+202E is kept as is.
- **Impact**: on Windows `NUL.flac`, `CON.flac`, `AUX.flac` and the like refer to devices whatever the extension. Saving to such a name either fails with an odd error or "succeeds" into the null device, and the task says "Saved". It needs a file-name override (or an artist / title) equal to a device name, so it is rare, but the function's own comment says its purpose is to be safe on any OS.
- **Fix**: prefix `_` when the stem (before the first dot) matches `^(con|prn|aux|nul|com[1-9]|lpt[1-9])$` case-insensitively; strip bidi control characters (U+202A to U+202E, U+2066 to U+2069); normalise to NFC.

### 🟢 DONE FILE-02. Two saves to the same destination share one staging file

- **Status**: Confirmed by reading.
- **Where**: `src/flows/musicDownloadFlow/utils/writeViaStaging.ts:9-12` (staging path is always `<name>.saving.<ext>`), `downloadTask.ts:1802` (the "name is taken" check happens before the long conversion).
- **What happens**: `saveGuard` prevents two saves on one task, not on one destination. Two tasks that resolve to the same "Artist - Title.flac" (the same track imported from two platforms, a duplicate in a playlist) and are saved at the same time both pass the "taken?" check, both write `Artist - Title.saving.flac`, and the `finally` of the first deletes the staging file under the second. Separately, a real file the user happens to have under that staging name would be overwritten and then deleted.
- **Fix**: unique staging name (`.saving-<uuid>`), and an app-wide lock per destination path around the check and the rename.

### 🟢 DONE TAG-02. Retagging drops the embedded cover art for Ogg, Opus and M4A

- **Status**: Reproduced with the app's ffmpeg arguments.
- **Where**: `tagAudioFile.ts:103-112` (`-map 0:a`, `-map_metadata -1`, `-map_metadata:s:a -1`).
- **Evidence**: M4A with a cover: streams before `aac,audio png,video`, after `aac,audio`. Opus with a `METADATA_BLOCK_PICTURE`: keys before `encoder, metadata_block_picture, title`, after `encoder, title`.
- **Impact**: FLAC and MP3 keep their picture (the code says so on purpose), the three other formats lose it. A Soulseek or relocated file that came with its artwork is saved without it. The comment in the code only considers yt-dlp leftovers.
- **Fix**: for M4A map the attached picture stream as well (`-map 0:v? -c:v copy -disposition:v attached_pic`); for Ogg / Opus read `METADATA_BLOCK_PICTURE` with ffprobe first and pass it back as a `-metadata`.
- **Done**: M4A keeps the picture stream as an attached picture; Ogg / Opus get the picture back as a `METADATA_BLOCK_PICTURE` (read from the tag, or built from the picture stream the demuxer shows), through a file (`-/metadata`) when it is too big for the command line. A failure to keep it tags without it.

### 🟢 DONE TAG-03. Re-saving tags the library file in place, synchronously for FLAC

- **Status**: Confirmed by reading.
- **Where**: `downloadTask.ts:1824-1831` ("reuse" mode calls `tagAudioFile(existingSavedPath)`), `src/utils/metadata.ts:64` (`NodeId3.removeTags(filePath)`, the synchronous API), `tagAudioFile.ts:60` (`NodeId3.Promise.update`), `metadata.ts:87` (`writeFlacTags`).
- **What happens**: a new save is built beside its destination and renamed (good). A re-save of an existing file ("update tags", rename) rewrites the user's file where it is. `node-id3` and `flac-tagger` both read the whole file and write it back; a crash, a kill or a full disk in the middle leaves the only copy truncated. For FLAC the first step is the synchronous `removeTags`, which reads and rewrites the whole file on the UI thread: a visible freeze on a 40 MB file on a slow disk, and a direct violation of the "no synchronous file-system calls in the download path" rule.
- **Fix**: tag a copy at the staging path and rename over the original (the code for that exists); replace `removeTags` by the async variant, or skip it when the file does not start with an ID3 header.
- **Done**: the copy-and-rename is used, and the FLAC ID3 clean-up is asynchronous and only runs when there is a tag to remove.

### 🟢 DONE DL-02. The end of a download run overrides the selection the user made during it

- **Status**: Confirmed by reading.
- **Where**: `downloadTask.ts`, `runDownloads`, the block after the provider loop (`selected: i === autoSelectedIdx` for every row).
- **What happens**: while Soulseek works through its candidates (minutes), the user can already select a finished yt-dlp row. `applyRowUpdate` carefully preserves `selected` on every update, but when the run ends the automatic choice is written over all rows. `retryDownloadProvider` gets this right ("a selection that lives on another provider is the user's, and stays").
- **Fix**: auto-select only when no row is selected at that moment.

### 🟢 DONE DL-03. In-flight download rows are addressed by position

- **Status**: Confirmed by reading.
- **Where**: `downloadTask.ts:148` (`activeAbortBySourceIndex`), `:2023-2035` (`slotByAttemptId`), `:1589-1638` (`retryDownloadSource` captures `sourceIndex`).
- **What happens**: cancel handles and row updates are keyed by the row's index in `downloadSources`. The code already defends against some shifts (`canShowMoreSources`, the check in `retryDownloadProvider`), which shows the design is fragile: a manual retry of one row (`retryDownloadSource`) runs for a long time while a provider retry can still remove rows before it, after which its updates land on another row and "reject" aborts the wrong transfer or none. The map is never cleared when the rows are reset.
- **Fix**: give each row a stable id (the agent tools already compute one, `downloadSourceIds`) and key everything by it.
- **Done**: rows carry a `rowKey` (kept by every update); cancel handles and the single-candidate retry find their row by it. `downloadSourceIds` (the agent's content-derived ids) is unchanged.

### 🟢 DONE BIN-02. ffmpeg is a nightly "master" build from a third-party repository, re-downloaded whenever it is republished

- **Status**: Confirmed by reading (the GitHub API is blocked here, so the republish cadence is not measured).
- **Where**: `src/utils/ffmpegBuilds.ts:10-11` (`ffmpeg-master-latest-win64-gpl.zip` of `FFmpeg-Builds/FFmpeg-Builds`, `releases/latest`), `:41` (the version id is the release's `published_at` date), `src/utils/checksum.ts:47-74`, `ffmpeg-setup.ts:108-119` (macOS: evermeet.cx, no verification), `mpv-setup.ts` (no checksum).
- **Points**:
    - The binary is the development branch of ffmpeg, not a release, built by a third party, and with "Auto-download latest binaries" on (the default) the newest one is fetched on first use of each launch. A new archive is about 200 MB, and the cached copy is replaced each time the date changes.
    - The checksum comes from the same release as the archive. It protects against a corrupt transfer, not against a compromised release. If the checksum list cannot be fetched, the binary is used anyway ("unverified").
    - macOS and mpv downloads are not verified at all (already noted in the previous audit).
- **Fix**: pin a known release and its SHA-256 in the source (updated with the app), make the checksum mandatory, and move "always latest" behind an explicit choice. The same applies to yt-dlp to a lesser degree (it is a real release with a published hash list, but still fail-open).
- **Done**: the newest stable ffmpeg branch (`n9.0`…) instead of master, downloaded again once a month, checksum mandatory for ffmpeg and yt-dlp (an archive that cannot be checked is refused). Not done: a SHA-256 pinned in the source (the checksum still comes from the same release), macOS (evermeet.cx) and mpv downloads are still unverified, and "always latest" is not behind a separate choice.

### 🟢 DONE BIN-03. The 200 MB ffmpeg archive is read and extracted synchronously

- **Status**: Confirmed by reading.
- **Where**: `src/utils/binaryArchive.ts:62-71` (`new AdmZip(zipPath)`, `zip.extractEntryTo(...)`).
- **Impact**: `adm-zip` loads the whole archive into memory and inflates synchronously. During the first download of a session the interface freezes for the length of the read and the inflation of a ~130 MB executable (twice: ffmpeg and ffprobe), with a few hundred MB of extra memory. This is the largest synchronous operation in the app and it sits in the download path.
- **Fix**: a streaming unzip (for example `yauzl`), or run the extraction in a worker thread.
- **Done**: the entries are extracted by the bundled 7-Zip in its own process (in-process extraction stays as the fallback where 7-Zip cannot run), into a folder of their own, then renamed.

### 🟢 DONE CRED-02. The `.env` file is world-readable, written non-atomically, and edited with read-modify-write

- **Status**: Reproduced for the mode (`644`); the rest from reading.
- **Where**: `src/utils/envFile.ts:21`, `:29`, `:64`, `:127` (`fs.writeFile(envPath, ...)`).
- **Points**:
    - On Linux and macOS the file holding the Spotify client secret and the Soulseek password gets the default mode `0644`: every local user can read it. `bin/cookies.txt` (the user's YouTube session) has the same exposure.
    - `writeFile` truncates then writes: a crash at that moment loses every stored credential. The other data files use temp + rename.
    - Each save reads the file, edits lines, writes it back. Two wizards finishing at the same moment (two providers, several tasks) can overwrite each other.
    - The key pattern is case-insensitive (`new RegExp("^" + key + "=", "i")`) while environment variables are case-sensitive on Unix, and the key is not escaped for the regular expression.
- **Fix**: write to a temp file with mode `0600` and rename; serialise writers with one promise chain; make the match case-sensitive and escape the key.
- **Done**: atomic write at `0600`, writers queued, key escaped. The match stays case-insensitive on purpose (a `spotify_client_id=` line left by hand is replaced, not duplicated). `bin/cookies.txt` is the user's own file and is not touched by the app.

### 🟢 DONE LOCK-01. A stale lock whose pid now belongs to another program keeps the app from starting

- **Status**: Reproduced (lock file containing the pid of an unrelated live process).
- **Where**: `src/utils/instanceLock.ts:19-27` (`isAlive`), `:58`.
- **Evidence**:

    ```
    Goblin Malin is already running on <data dir> (process 3557).
    Close it first, or set GOBLIN_DATA_DIR to use another data folder.
    If it is not running, delete <data dir>/app.pid.lock and start again.
    ```

    Process 3557 was a shell.

- **Impact**: after a crash or a power cut the lock file stays. Pids are recycled quickly (after a reboot, low pids are all taken by system services), so the app can refuse to start until the user deletes a file by hand. The message does explain how, which limits the damage.
- **Also**: two instances starting together on a stale lock can both remove it and both get in (`rmSync` then `wx`, lines 53-60).
- **Fix**: store the process start time (or a random token plus a heartbeat timestamp refreshed every minute) with the pid, and treat a lock older than a couple of heartbeats as stale.
- **Done**: the owner touches the lock every minute and a lock untouched for five minutes is stale; a stale lock is moved aside (and put back if it turns out not to be the stale one) instead of deleted, so two instances starting together cannot both take it.

### 🟢 DONE TTY-01. Started without a terminal, the app shows a React "Too many re-renders" error and never exits

- **Status**: Reproduced (`echo "" | yarn dev`, output to a file).
- **Where**: start-up path; `src/index.tsx:81-88` only guards the stdin calls.
- **Evidence**: output contains `ERROR  Too many re-renders. React limits the number of renders to prevent an infinite loop.`; the process was still alive after 12 s and had to be killed.
- **Impact**: any non-interactive launch (a pipe, a service manager, some IDE terminals, CI smoke tests of the published binary) hangs with an internal error instead of a clear message. There is also no argument handling at all: `goblin-malin --version` and `--help` start the full TUI (CLI-01).
- **Fix**: at the top of `start()`, if `!process.stdout.isTTY || !process.stdin.isTTY`, print one line and exit with code 1; handle `--version` / `--help` before anything else.

### 🟢 DONE CACHE-01. The API cache hands out shared objects, changes their types across restarts, and never shrinks

- **Status**: Confirmed by reading.
- **Where**: `src/utils/cache.ts:21-33`, `:77-80`, `:101-103`.
- **Points**:
    - A cache hit returns the very object stored in memory. Every task that asks for the same URL gets the same `TrackMetadata` instance; any code that mutates it (now or in a future change) silently edits the cache and every other task.
    - `fetchedAt: new Date()` is a `Date` on a miss and on a same-session hit, but a string after a restart, because the cache file is JSON. `TrackMetadata.fetchedAt` is typed `Date` (`types.ts:145`). Sessions have `reviveTaskDates` for this; cache hits do not. Any `.getTime()` on a cached value would throw only after a restart, which is the kind of bug tests never see.
    - 90-day TTL, no size limit, full albums and playlists stored whole. `persistInterval` makes `flat-cache` write the whole file synchronously every two minutes on the UI thread, and again at exit.
- **Fix**: `structuredClone` on the way out (or freeze on the way in), revive dates in one place, cap the entry count, and persist asynchronously.
- **Done**: capped at 3,000 entries (LRU), saved in the background through a temporary file, dates revived in one place. The first point does not apply to the installed `flat-cache` 6.x: it already hands out copies.

### 🟢 DONE SET-02. Pressing Esc in a setup wizard switches the provider off for good

- **Status**: Confirmed by reading.
- **Where**: `src/base/env.ts:69-74`, `:102-107`, `:132-138` (`persistProviderDisabled`).
- **What happens**: when a provider needs credentials, the wizard opens in the middle of a run. If the user closes it (Esc, or a slip while the list is busy), the provider's `enabled` setting is written as `false`. From then on Spotify links fail with "switched off in Settings" and no wizard is offered again. Only a log line says so.
- **Fix**: closing the wizard should fail this task's step, not change a setting; or ask "turn Spotify off?" explicitly.

### 🟢 DONE CLAUDE-01. A broad pattern can mistake an ordinary failure for "quota reached" and block Claude for ten minutes

- **Status**: Confirmed by reading.
- **Where**: `src/flows/musicDownloadFlow/services/apis/claude-client.ts:107-113` (`classifyFailure`), `:161-163`, `:187-189` (cooldown), also used by `claude-agent-client.ts:325`.
- **What happens**: the failure text (the CLI's result text, which can be the model's own words, or stderr) is matched against `/usage limit|limit reached|rate limit|quota|too many requests|resets? (at|in)/i`. Any failure whose text mentions a rate limit of a _website_ the model visited, the word "quota", or "reset in" is classified as the plan's quota and sets a process-wide ten-minute block on both the discovery provider and the chat. Similarly `/authentication|unauthori[sz]ed/` turns unrelated failures into "not logged in".
- **Fix**: classify from structured fields of the CLI's JSON envelope (`subtype`, API error type) and only fall back to text for stderr.
- **Done**: the HTTP status is used when the CLI reports one (`api_error_status`); otherwise the CLI's own `result` text only counts when it starts like an error, and stderr is read whole. The status field name is the one recent CLI versions use; where it is absent the text rule applies.

### 🟢 DONE UI-01. The task action bar is cut at the right edge; the last actions cannot be seen

- **Status**: Reproduced (live TUI at 140 and 150 columns).
- **Where**: `src/components/TaskListPanel/ActionBar.tsx`.
- **Evidence**: the second hint line ends with `... [D] Re-discover metadata providers  [W] Download so│` at 150 columns and `[W] D│` at 140. Whatever follows (toggle tagging, toggle downloading, paste link...) is not shown anywhere.
- **Impact**: the hint bar is the only place these keys are advertised. On a normal 120-column terminal about half of the task actions are invisible.
- **Fix**: wrap to a third line, shorten labels when space is short, or end with a "more" hint that opens the full list.
- **Done**: hints that do not fit are shown as their key (`[T]`), and `…` ends a row where even that does not fit.

---

## 7. Findings, low severity and hardening

Shorter entries. "Reading" means confirmed by reading.

### Data and sessions

- 🟢 DONE **DATA-04. A duplicated session shares everything with its original.** (Reading) `src/sessions/sessionManager.ts:193-209`. `duplicateSession` copies the tasks with the same task ids, the same temp-file paths, the same `savedFile` records and the whole archive. Work in the copy (re-save under another name, Soulseek retry, clean-up) deletes or moves files the original session still points at. Fix: say so in the UI, or drop `savedFile` and download rows from the copy. _Done: Duplicate now asks first and says the copy shares its files with the original (`SessionsModal.requestDuplicate`)._
- 🟢 DONE **DATA-05. Saving from another download deletes the file the saved record points at, wherever it is.** (Reading) `downloadTask.ts:1852-1856`. `savedFile.path` can be changed by "Relocate" (`relocateSavedFile`, any existing path). A later save from a different download row unlinks that path. If the user relocated to a file they keep elsewhere (another copy, another tool's library), it is deleted without a question. Fix: only delete a file the app wrote itself (keep the original path and compare), otherwise ask. _Done: `savedFile.writtenPath` records where the app wrote the file; a file relocated away from it is deleted only if the user answers "Delete it" (`confirmDeleteRelocated`; no answer keeps it). Files saved by older versions have no `writtenPath` and count as the app's own._
- 🟢 DONE **DATA-06. Archiving an album whose track is busy splits the album.** (Reading) `sessionManager.ts:230-270`. Busy children are skipped, the parent and the idle children are archived. The busy child stays in the list with a `parentTaskId` that no longer exists; restoring the album later skips it "already in the queue". Fix: refuse to archive a collection while any child is busy. _Already fixed by `withoutBusy` (`busyTasks.ts`): a collection goes whole or not at all. Test added in `dataAndSessions.test.ts`._
- 🟢 DONE **DATA-07. After a restart the row keeps the old Songlink and MusicBrainz cells.** (Reproduced in the TUI run of DATA-01) `downloadTask.ts:1433-1444` resets groups and sources but not `discoveryAnchors`; the SONGLINK cell still shows its count and MB its mark while the track has no metadata at all. Fix: reset the anchors with the groups. _Done in `resetForRerun()` and in `start()` from "stopped"._
- ⚪ WON'T FIX **DATA-08. Sessions only grow.** (Reading) `sessionStore.ts`. Every session and every archive lives in one `sessions.json`, loaded whole into memory and never pruned; deleting a session does not delete its temporary downloads (they wait for a manual clean-up). Up to 100 hidden Soulseek candidates per search are stored per row. Fix: one file per session, and offer to delete a session's temp files with it. _Decision: nothing to do. A session can be deleted in the Sessions modal, and Settings → Download already clears unused temporary downloads (manual action, reminder, 48 h auto-delete), independently of sessions._
- 🟢 DONE **DATA-09. A track cannot be in two collections.** (Reading) `collectionTask.ts` (`fetchAndSpawn`: "Skipping track already in queue"). The task id is derived from the URL, so a track already present (alone or in another playlist) is silently left out of the album; the album then shows fewer tracks than its `totalCount` with no explanation. Fix: show a placeholder row that points at the existing task. _Decision: one row per track is intended; the album now says how many tracks were left out (`alreadyQueued`: "47 tracks (3 already in the queue elsewhere)") and logs it at info level._

### Running

- ⚪ NOT A PROBLEM **RUN-05. Links imported during "Run all" start by themselves.** (Reading) `orchestrator.ts:170-173`. With no id filter, the pump takes every candidate, including tasks added after the run began. Probably intended for playlists, surprising for a paste. Decide and document. _Decision: intended, nothing to change._
- 🟢 DONE **RUN-06. A metadata slot is held while the app waits for the user.** (Reading) `downloadTask.ts:308-316`, `:965-977`. The consent dialog and the last-resort Claude call both happen inside `metadataLimiter.run`. With the default limits, a few tasks waiting on a dialog nobody answers stop all metadata work. Fix: release the slot while waiting for a person. _Done: `Semaphore.whileWaiting()` gives the permit back (and takes one again after); the first-use consent dialog and the last-resort call use it._
- 🟢 DONE **RUN-07. The fallback for primary metadata calls every discovery service with an empty track.** (To verify) `downloadTask.ts:398-453`. When the service that owns the link fails, the loop calls `discoverFromUri` on all enabled discovery services with a stub (`trackName: ""`, no artists). That includes the last-resort service if it is enabled, which would spend a Claude call on an empty question, and Songlink without going through `awaitDiscoveryConsent` (it is only in the list once enabled, so consent itself holds). Worth a test. _Done: the fallback skips last-resort services; test in `discoveryStage.test.ts`. Songlink keeps working from the link, as intended._
- 🟢 DONE **DISC-01. Small inconsistencies in discovery.** (Reading) `downloadTask.ts:549-553`: `primaryMetadata.platform === service.id.toLowerCase()` compares a platform key with a class name, so it is never true (the next check does the real work). `:630`: after a skip, `discoverEverywhere()` keeps running in the background and a late rejection would be unhandled. `:660`: `metadataDiscovered: true` is set even when the stage was skipped or aborted. _Done: the dead comparison is removed (the registry-key check stays), a late failure after a skip is caught and logged, and a stopped stage no longer sets `metadataDiscovered` (a stage the user skipped still does: the user ended it on purpose)._

### Downloads

- **DL-04. yt-dlp: listener leak and an aborted signal that is not checked.** (Reading) `YtDlpService.ts:99-101`, `:271-276`. The outer abort listener is only removed on the path that actually runs yt-dlp (not when a cached file is reused, not when set-up throws). A signal that is already aborted on entry never fires the event, so the download starts anyway.
- **DL-05. Leftovers after a failed yt-dlp run; child processes on Windows.** (Reading / to verify on Windows) `YtDlpService.ts:278-287`, `:336-345`. The clean-up of `.part` files only runs for aborts. A run that fails leaves its partial files under a uuid that no later attempt will reuse. On Windows, `dl.kill()` ends yt-dlp but not an ffmpeg it spawned, so the file may stay locked and the `unlink(...).catch(() => {})` silently fails.
- **DL-06. A warning on every download.** (Reading) `YtDlpService.ts:208`: "No cookies file found, proceeding without cookies" is logged at `warn` level for each track, which is the normal case for most users. Use `debug`.
- **DL-07. yt-dlp reads the user's own configuration.** (Reading) No `--ignore-config`. A user's `yt-dlp.conf` (output template, format, post-processors, `--embed-thumbnail`) silently changes what the app gets and can break the "find the produced file" step. The library also passes `--js-runtime node`, which makes yt-dlp run YouTube's player JavaScript with the user's Node; that is the library's default, worth knowing about.
- **DL-08. No size, duration or live-stream guard.** (Reading) A link to a ten-hour video or a live stream is downloaded as a "track" until the disk fills. Soulseek trusts the size the peer announces with no ceiling (`SoulseekService.ts:242-249`). Fix: `--max-filesize`, `--match-filter "!is_live"`, a cap on announced sizes.
- **DL-09. Several common YouTube link shapes are not recognised.** (Reading) `YoutubeService.ts:191-224`: `/shorts/<id>`, `/live/<id>`, `/embed/<id>` and `youtube-nocookie.com` return null ("not a link the app can read"); `youtu.be/<id>/anything` yields an id containing a slash; a `/watch` link without `v=` is accepted as a track with no id. Also, only one artist is read and for ordinary videos it is the channel name.

### Soulseek

- **SLSK-03. Smaller points.** (Reading) Any `.flac` from a peer is labelled "lossless" from its extension alone (`SoulseekService.ts:655-659`); the client listens for incoming peer connections on a TCP port (firewall prompt on first use, and a network parser exposed to the internet, `:148-156`); the numeric settings are read with `Number(x) || default`, so `1` or a negative value is accepted (`:309`); the wizard text suggests any password while CRED-01 can then break it.

### Tags

- **TAG-04. Album artist can be written empty; several artists are one string in four formats out of five.** (Reading) `metadata.ts:33`, `tagAudioFile.ts:38`, `:70`: `metadata.albumArtists ?? metadata.artists` does not fall back when `albumArtists` is an empty array, which writes an empty ALBUMARTIST. FLAC gets one value per artist; MP3, Ogg, Opus and M4A get "A, B" in a single value, which later tools cannot split ("Tyler, The Creator").
- **TAG-05. The retag rename has no retry on Windows; dates are years only.** (Reading) `tagAudioFile.ts:120` uses a bare `fs.promises.rename`, while `renameReplacing` exists for exactly the antivirus / indexer case. `DATE` and `YEAR` both receive the four-digit year even when the source has a full date.

### Exit, update, CLI

- **EXIT-01. The exit code is 0 even when the session could not be saved.** (Reading) `src/utils/exitApp.ts:36-44`, `:78-82`, `:94`. `finish()` always calls `process.exit(0)`, including after "Your latest session changes could not be saved" and after the 8 s safety timeout.
- **EXIT-02. Child processes at exit.** (To verify) I found an exit hook for mpv (`mpvExitHook.test.ts`) and a clean-up registry for the Claude CLI, but nothing that kills in-flight yt-dlp, ffmpeg or the package-manager update when the app quits or crashes. They would keep running and writing after the lock is released.
- **UPD-01. The release page is opened with `open()` instead of the app's own `openUrl()`.** (Reading) `src/components/UpdateModal/UpdateModal.tsx:66`. `openUrl.ts` exists to accept only http(s) and to avoid a shell; the updater passes a URL that came from the network straight to the `open` package. The source is the GitHub API, so the risk is small, but it is the one place that skips the guard.
- **UPD-02. Updater details.** (Reading) `installSource.ts:10-15`: the installer is guessed from substrings of the script path (`/yarn/`, `/npm/`), so a user or folder named "yarn" selects yarn. `UpdateModal.tsx:77-103`: no timeout on the update command, Esc hides the modal while it keeps running, output chunks are split with `toString()` (broken multi-byte characters, `\r` kept on Windows). `updateChecker.ts:9-16`: `isNewer` turns "0.2.4-beta.1" into `NaN` (known as REL-08).
- **CLI-01. No command-line arguments.** (Reproduced) `goblin-malin --version` and `--help` start the TUI (or print the "already running" message). `src/cli.ts` reads no argument at all.

### Claude and the agent

- **CLAUDE-02. The Claude CLI runs in the shared temp folder.** (Reading) `claude-client.ts:203`, `claude-agent-client.ts:258` (`cwd: os.tmpdir()`). On Linux `/tmp` is shared between users. The calls pass `--setting-sources ""` and `--strict-mcp-config`, which should make project files there irrelevant, but an empty private folder (`mkdtemp`) removes the question, and also keeps the CLI's per-folder session history for the chat out of a bucket shared with every other tool that runs in `/tmp`.
- **CLAUDE-03. Every child process inherits all the app's secrets.** (Reading) `constants.ts:29` loads `.env` into `process.env`; yt-dlp, ffmpeg, ffprobe, mpv, 7za, the package manager and the Claude CLI are all spawned with the inherited environment (explicitly `{ ...process.env, ... }` in `claude-agent-client.ts:259`). None of them needs the Spotify secret or the Soulseek password. Fix: keep credentials in a module-level map instead of `process.env`, or pass a filtered `env`.
- **AGENT-01. The per-task change budget is checked and counted on both sides of an await.** (Reading) `agent/taskAccess.ts:103-119`, `base/task/taskLock.ts:62-90`. `checkBudget` runs before the change and `count` after it; leases are re-entrant for the same holder. Two calls of an asynchronous write tool on the same task in one turn (for example `rediscover`) both pass the check and run side by side, each rebuilding the metadata groups. Synchronous writes are protected by the revision check. It needs the CLI to issue write calls in parallel, which it normally does not. Fix: count first and give the budget back on failure; serialise writes per task.
- **AGENT-02. Small hardening points.** (Reading) The MCP config file is created in `os.tmpdir()` with `writeFile` (no exclusive flag, default mode, `agentChat.ts:225`, `:324`); it holds only the loopback URL, the token travels in the environment, so exposure is minimal. `agent.log` keeps every message, answer and tool call in clear text up to 10 MB, and the last conversation is saved to `agent-chat.json`; worth one line in the consent text and in `SECURITY.md`.
- **SEED-01. The MusicBrainz release id from the redirect is trusted if it looks like a UUID.** (Reading) `musicbrainz/seedServer.ts:110-115`. Anyone who knows the one-time token can report a release id; only MusicBrainz and the browser do. A lookup of the id before storing it would close it.

### Other

- **MPV-01. The mpv control socket has a predictable name in the temp folder.** (Reading) `src/utils/mpvPlayer.ts:46-53`: `<tmp>/mpv-ipc-<pid>.sock` (a named pipe `mpv-ipc-<pid>` on Windows). mpv's JSON IPC can run arbitrary commands, so the socket is as sensitive as a shell. A pre-existing file owned by someone else makes `unlinkSync` throw and breaks preview. Fix: put the socket in a `0700` folder under the data folder.
- **HTTP-01. Downloads have an idle timeout only.** (Reading) `src/utils/http.ts`: no total size or time limit for `downloadFile` and `httpsGetText`; `binaryArchive.ts:57` calls `downloadFile(source.url, zipPath)` and forgets the `userAgent` it was given.
- **COOKIE-01. Cookie copies can be left behind.** (Reading) `cookiesCopy.ts`: the per-run copy of `cookies.txt` lives in a private temp folder (good) and is removed in `finally`; a crash or kill leaves the user's YouTube session in `/tmp` until the system cleans it.
- **LOG-02. Logging details.** (Reading) `index.tsx:71` logs the rejected `promise` object itself; `logger.createChild({ task })` keeps a reference to the whole task in every service logger; `downloadTask.ts:1783` logs the whole save settings at `info` for each save.
- **UI-02. Symbols of ambiguous width break the frame.** (Reproduced in the harness's terminal) On the Settings row "App directory (read-only)" the folder symbol makes the row one column short and the modal's right border jumps. Other symbols used in the toolbar and lists are in the same Unicode class. Real terminals disagree about their width. Fix: use symbols with an unambiguous width, or measure with the same table the terminal uses.
- **PKG-01. Installing the package writes outside the package.** (Reading) `scripts/save-install-source.mjs` (postinstall) creates the user's data folder and `install.json`. It cannot fail the install and is harmless, but tools that audit install scripts flag it; the same information can be found at run time (the updater already tries the script path first).

---

## 8. Security review, by attack surface

The app runs locally with the user's rights, downloads executables, parses files sent by strangers (Soulseek), talks to several web services and, optionally, lets a language model call tools. This section walks through each surface and says what protects it and what does not.

### 8.1 Process spawning

| Call site                                     | Shell?                  | Arguments from                         | Verdict                                                                                      |
| --------------------------------------------- | ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| yt-dlp (`ytdlp-nodejs`)                       | no                      | track URL after `--`, fixed options    | Sound against option injection. See DL-01 (playlist), DL-07 (user config), DL-08 (no limits) |
| ffmpeg (`ffmpegRun.ts`, `execFile`)           | no                      | absolute paths, tag values as argv     | Sound. Paths are absolute, so none can be read as an option                                  |
| ffprobe (`probeAudio.ts`)                     | no                      | file path                              | Sound; no timeout (NET-01)                                                                   |
| mpv (`mpvPlayer.ts`, `mpvMix.ts`)             | no                      | fixed, then JSON IPC                   | See MPV-01 for the socket location                                                           |
| Claude CLI (`claude-client.ts`, agent client) | no                      | fixed flags, prompt on stdin           | Good design (see 8.5). User-set command path is by design. See CLAUDE-02, CLAUDE-03          |
| Package manager (`UpdateModal.tsx:77`)        | **yes on Windows only** | constants + version checked by a regex | Acceptable: `SAFE_VERSION` in `installSource.ts:32` only lets plain semver through           |
| Browser / file manager (`openUrl.ts`, `open`) | no                      | URL (http/https only) or folder        | Sound, except UPD-01 which bypasses `openUrl`                                                |
| 7za (`mpv-setup.ts:139`)                      | no                      | archive path, fixed filter             | Sound                                                                                        |

No call builds a shell command from remote or user text. That is the most important property here and it holds.

### 8.2 Downloaded executables

- yt-dlp and the Windows ffmpeg archive are checked against a SHA-256 list from the same release; a missing list is tolerated; macOS ffmpeg and mpv are not checked (BIN-02).
- Updates are not atomic (BIN-01): a truncated yt-dlp can be executed after an interrupted download. A truncated executable usually just fails to start, so this is a reliability problem more than a security one.
- The binaries live in the user's data folder, writable by the user: normal for a per-user tool.
- "Latest nightly from a third-party repository, fetched automatically" is the largest supply-chain exposure of the app. It is a product decision; pinning is the mitigation.

### 8.3 Files from strangers

- Soulseek files are saved under names the app generates (`generateTempFilename`), never under the peer's name. The remote path is only displayed. I found no way for a peer to choose where a file lands.
- Those files are then parsed by ffprobe, ffmpeg, `flac-tagger`, `node-id3` and played by mpv. That is unavoidable; keeping ffmpeg and mpv current matters for this reason (which argues for pinned _releases_ rather than nightlies).
- Zip extraction is flat by base name (`binaryArchive.ts:71`): no path escape.

### 8.4 Local HTTP servers

Two servers exist, both on `127.0.0.1` with a random port.

- **Agent MCP server** (`base/agent/mcpServer.ts`): bearer token per chat turn (256 bits, `agentRuntime.ts:47`), `Host` header must be the server's own address (DNS rebinding), any request with an `Origin` header is refused (browsers), 1 MB body limit, POST only, 10 s header timeout. Tool inputs are validated against each tool's JSON Schema with a small validator that rejects unknown properties and uses `Object.hasOwn` (no prototype tricks). This is careful work. Remaining notes: AGENT-01 and AGENT-02.
- **MusicBrainz seed server** (`musicbrainz/seedServer.ts`): one-shot, token in the path, `Host` check, GET only, every interpolated value HTML-escaped, closes on the redirect or after 15 minutes. No finding beyond SEED-01.

### 8.5 The chat agent

- The CLI is started with `--tools ""`, `--setting-sources ""`, `--strict-mcp-config` and an explicit allowlist of the app's own tools. The model has no shell, no file access and no web in this mode.
- There is **no tool that changes settings**. The agent cannot change the output folder, the Claude command, or switch providers on. `get_settings` redacts values whose key looks like a secret and masks the user's name and home folder.
- Writes go through named methods with a lock, a revision check, a per-turn budget and an undo journal. Downloads and archiving ask the user first.
- Text from tasks, titles and logs is treated as data. The worst a prompt-injected title can do is make the model propose metadata edits within the budget, add tasks (`add_tasks`, no confirmation, undoable) or trigger network lookups (`run_metadata`, `rediscover`, `lookup_url`, no confirmation). That is a reasonable residual risk; it is worth stating in the consent text that reading a track's metadata can influence what the assistant does next.

### 8.6 Secrets at rest and in memory

- `.env` and `bin/cookies.txt` are plain text with default permissions (CRED-02), and `.env` values can be mangled (CRED-01).
- All secrets are in `process.env` and inherited by every child process (CLAUDE-03).
- Logs: I did not find a place that logs a credential. `settingsView.ts` shows that redaction was thought about for the agent; the file logger has no equivalent filter, so it depends on call sites staying careful.

### 8.7 Outbound requests

- URLs returned by Songlink, MusicBrainz or Claude are only fetched through the metadata service whose `parseUrl` recognises the host, so a remote answer cannot point the app at an arbitrary address.
- `http.ts` refuses an https to http redirect and limits redirects to five.
- The updater validates the version before it reaches a command line.

---

## 9. Performance review

### Measured

Render profile on the project's own `perf-scale-2000.json` scenario (2,000 tasks, dev build with the profiler, so absolute numbers are pessimistic):

| Interaction         | Commits | React (ms) | Ink output (ms) | Layout (ms) | Write (ms) |
| ------------------- | ------- | ---------- | --------------- | ----------- | ---------- |
| boot                | 3       | 260.8      | 104.3           | 15.7        | 7.6        |
| `↓` (typical)       | 1       | 9 to 13    | 5 to 11         | 0.6 to 1.5  | 0.3 to 1.1 |
| `↓` (first two)     | 2       | 18 to 29   | 8 to 18         | 1.7         | 2.5 to 8.0 |
| `Ctrl+A`            | 2       | 34.4       | 17.0            | 1.6         | 0.7        |
| view switch `1`/`2` | 4       | 42 to 49   | 15 to 28        | 3.7 to 5.2  | 0.3 to 2.3 |

Anomalies reported by the harness: one `warn` ("4 commits over 20 ms, worst 48 ms"), no `error`. The list is clearly windowed and the earlier performance audits did their job. I have no rendering finding to add.

### Found by reading (all are blocking calls on the UI thread)

| ID               | Where                          | What blocks                                                                                                              |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 🟢 DONE BIN-03   | `utils/binaryArchive.ts:62-71` | Reading and inflating a ~200 MB zip with `adm-zip`, twice (ffmpeg, ffprobe)                                              |
| 🟢 DONE TAG-03   | `utils/metadata.ts:64`         | `NodeId3.removeTags` reads and rewrites the whole FLAC synchronously on every FLAC save                                  |
| 🟢 DONE CACHE-01 | `utils/cache.ts:21-33`         | `flat-cache` writes the whole API cache synchronously every 2 minutes and at exit                                        |
| QUAL-03          | see section 10                 | `existsSync` / `mkdirSync` in both download providers, `existsSync` on the save path                                     |
| 🟢 DONE RUN-02   | `runController.ts:24-32`       | "Run all" on a reopened session starts every task once (2,000 no-op starts and status writes)                            |
| DATA-08          | `sessions/sessionStore.ts`     | The whole `sessions.json` is kept in memory; serialisation is cached per object, so only growth of the file itself costs |

### Not measured

The production bundle latency bench (`bench/latency.ts`) and idle CPU were not run. Windows terminal behaviour (where the project notes that every commit repaints) was not observable here.

---

## 10. Code quality, rules of CLAUDE.md, dead code

### Rules that hold

- **One `useInput`**: only `ShortcutDispatcher.tsx:46` and the documented exception `ChatInput.tsx:57`. A commented-out one remains in `FullScreenBox.tsx:13`.
- **No shell**: see 8.1.
- **Providers are not hard-coded**: the pipeline code I read goes through the registries and static capabilities.
- **Library spinners**: none found; animation goes through the global ticker.

### Rules that are broken

- **QUAL-03. "No synchronous file-system calls in render or in the download path."** (Reading)
    - `services/download-providers/ytdlp/YtDlpService.ts:185-186` (`existsSync`, `mkdirSync`), `:203` (`existsSync`)
    - `services/download-providers/soulseek/SoulseekService.ts:324-325`, `:609-610`
    - `utils/computeOutputPath.ts:44` (`existsSync` inside `isOutputPathTaken`, called from `runSave`)
    - `components/SecondaryPanel/DownloadPanel/DownloadPanel.tsx:371`, `components/ArchiveModal/ArchiveModal.tsx:120` (`existsSync` in handlers)
    - `utils/metadata.ts:64` (`NodeId3.removeTags`, the big one, see TAG-03)
    - `utils/mpvPlayer.ts:79-80`, `:131`
- **QUAL-04. "Animations go through `useGlobalTicker`."** (Reading) `components/SecondaryPanel/DownloadPanel/DownloadSourceDetail/DownloadInProgress.tsx:19-27` has its own one-second `setInterval` to refresh the elapsed time. It ignores Settings, Animations and adds a commit per second while a download is shown.
- **"User data is never rebuilt away"**: broken for `metadataOverride` (DATA-03).
- **Hints must not hard-code keys**: five `<Hint shortcut="...">` literals remain (`ChatPanel.tsx:446`, `SettingsModal.tsx:581`, `PromptModal.tsx:112`, `:119`, `:120`). The rule allows them for keys owned by third-party inputs if a comment says so; I did not check each comment.

### Dead or duplicated code

- **QUAL-01. Dead code.** (Reading)
    - `src/flows/musicDownloadFlow/utils/input-loader.ts` (146 lines): no importer anywhere in `src/`. It reads a file from the data folder with `readFileSync`; if it is revived, that needs a second look.
    - `src/utils/useWhyDidYouUpdate.ts`: no importer.
    - `src/index.tsx:19-53`: `write`, `cleanUpOnExit` and `withFullScreen` are not used by `start()`; `withFullScreen` is exported from the package entry, so it is public API that nothing exercises.
    - `YoutubeService.getVideo`, `getArtist`, `getAlbum` (`YoutubeService.ts:94-189`): cached wrappers with no caller in the files I read.
    - `downloadTask.ts:549-553`: a condition that can never be true (DISC-01).
- **QUAL-02. Duplication.** (Reading)
    - `src/base/env.ts:50-130`: the "modes" and "no modes" branches of `getVariablesWithWizard` are the same thirty lines twice.
    - `findExistingBinary` and `cleanupOldVersions` exist in `ffmpeg-setup.ts`, `ytdlp-setup.ts`, `mpv-setup.ts` (and `ffprobe-setup.ts`), each slightly different. BIN-01 has to be fixed in each copy.
    - The spawn-error-to-message mapping is copied between `claude-client.ts:235-246` and `claude-agent-client.ts:309-318`.
    - The "reset a track" object literal exists three times (DATA-03), which is exactly why the three copies drifted from the rule.
- **QUAL-05. Type escapes.** (Reading) 71 `eslint-disable` comments and 57 `as unknown as` casts in `src/`; several build a `TrackMetadata` from a partial literal (`downloadTask.ts:399-408`, `:1229-1239`), which hides fields the type says are present (see CACHE-01 for `fetchedAt`). 25 lint warnings in tests.
- **QUAL-06. Mixed byte-order marks.** (Reading) 63 files under `src/`, `scripts/`, `tests/` start with a UTF-8 BOM (for example `utils/appPaths.ts`, `base/logger/logger.ts`, `utils/cache.ts`, `YtDlpService.ts`), the rest do not. `check-utf8.mjs` accepts both. It is harmless to the compiler but produces noisy diffs and occasional tool surprises; pick one (no BOM) and enforce it in the check.

---

## 11. Tests, CI, documentation

- **TEST-01. End-to-end tests do not run in CI.** (Reading) `.github/workflows/ci.yml` runs `npx vitest run tests/unit --coverage`. The four files in `tests/e2e` (collections, groups, perf, render profile) only run on a developer's machine with `yarn test`. They passed here on Linux.
- **DOC-01. The README's first harness example cannot run.** (Reproduced) `scripts/tui-test/examples/navigate-settings.json` contains `//` comments; `scripts/tui-test/cli.ts:100` uses `JSON.parse`. Running the command printed in `scripts/tui-test/README.md` gives `Error: Unexpected token '/' ... is not valid JSON`. No test loads this example. Either strip comments in the loader (the README itself shows scenarios with comments) or remove them from the file.
- **DOC-02. Stale statements.** (Reading)
    - `TODO.md`: "Get the unit tests green on Linux CI ... (they only run on Windows now)": the CI matrix already includes Ubuntu and the tests pass on Linux.
    - `TODO.md` header: "working towards v0.2.0" while `package.json` is 0.2.3; `CLAUDE.md` says "heading to v0.2.0".
    - `AUDIT-v0.2.1.md` section 3: "lint passes with 0 warnings" (25 today).
    - `TODO.md` still lists "Linux has no working ffmpeg/ffprobe download": still true (`ffmpeg-setup.ts:105-125` has a macOS branch and treats everything else as Windows), and worth a clear statement in the README because the result on Linux is a 200 MB Windows archive extracted to a file that cannot run.
- **DEP-01. Dependency hygiene.** (Reading) `.github/dependabot.yml` covers GitHub Actions only, not npm; `yarn audit` is not part of CI; the one open advisory (`zod` through `ytmusic-api`) is known. Actions are pinned by commit hash and the release uses npm provenance: both good.
- **Test gaps that match the findings**: no test restarts a task and checks `metadataOverride` (DATA-03); no test reads an M4A back with a non-ffmpeg reader (TAG-01); no round-trip test for `.env` values (CRED-01); no test switches the task list during a run (RUN-01); `saveTrack` itself has no unit test (already in `TODO.md`).

---

## 12. Things checked and found correct

- Session writes are atomic (unique temp file, rename with retry for Windows locks), coalesced, retried with backoff, and the user is told after three failures. A damaged file is quarantined, never overwritten, and the previous launch's copy is restored.
- A file from a newer version of the app is loaded as is and a copy is kept.
- The data folder is derived, never read from settings.
- Temp clean-up only touches files that carry the app's uuid signature, refuses dangerous folders (root, home, the output folder, anything containing them, compared after resolving symlinks), and leaves files written in the last two minutes alone.
- Soulseek and yt-dlp temp names are generated by the app; text parts are sanitised and length-capped.
- New saved files are built beside the destination and renamed; a failure leaves the previous file intact; a file replaced after confirmation is not deleted as "created by this save".
- Saving is single-flight per task.
- The overwrite check ignores the task's own saved file and asks for anything else.
- Consent for Songlink and Claude is asked once, one dialog at a time, shared by all waiting tasks, and "no answer" is never read as yes.
- Last-resort (Claude) results are only kept if the platform confirms the link and the confidence check passes.
- The MCP server and the seed server (section 8.4).
- The updater's version check before building a command line.
- `http.ts`: redirect limit, no downgrade to http, partial file removed on failure.
- Crash and signal handlers restore the terminal and save what they can within a bounded time.
- Rendering performance at 2,000 tasks (section 9).

---

## 13. Suggested order of work

**First, the things that destroy work or produce wrong files** (each is small):

1. 🟢 DONE DATA-03: stop resetting `metadataOverride` in the three places; add the test. (minutes)
2. 🟢 DONE DATA-01, DATA-02: confirmation before Restart on a track with anything to lose, and before restarting a collection. (Routing the restart through the orchestrator is not done: see RUN-04.)
3. 🟢 DONE DL-01: build the yt-dlp URL from the video id and pass `noPlaylist`. (minutes)
4. 🟢 DONE TAG-01: remove `use_metadata_tags`; decide how to carry ISRC and MusicBrainz ids in M4A.
5. 🟢 DONE CRED-01: quote and escape `.env` values; round-trip test. (CRED-02, mode `0600` and atomic write, is not done.)
6. 🟢 DONE RUN-01: refuse session changes during a run.
7. 🟢 DONE BIN-01: download to a temporary name, verify, rename, then clean old versions.
8. 🟢 DONE SET-01: catch and report settings write failures; log handler errors through the logger directly.

**Then, reliability of a run**: RUN-02, RUN-03, RUN-04, NET-01, SLSK-01, SLSK-02, DL-02, DL-03.

**Then, quality of what is downloaded and saved**: RANK-01, RANK-02, RANK-03, TAG-02, TAG-03, FILE-01, FILE-02, DL-07, DL-08, DL-09.

**Then, platform and start-up**: TTY-01, CLI-01, LOCK-01, BIN-02, BIN-03, the Linux ffmpeg question.

**Finally, housekeeping**: the QUAL, DOC, TEST and DEP items, and the remaining low entries.

---

## Appendix A: reproduction scripts

All scripts were run from the repository root with a throwaway data folder, for example:

```bash
GOBLIN_DATA_DIR=$(mktemp -d) GOBLIN_NO_AUDIO=1 npx tsx <script>.ts
```

They sat in a scratch folder outside the repository, with a `package.json` containing `{"type":"module"}` and a `node_modules` link to the repository's, so that top-level `await` and the dependencies resolve. They import the app's own source files by absolute path (`/home/user/goblin-malin/src/...` here): adjust `R` to your checkout. They can also be turned into unit tests almost as they are.

### A.1 `r1_env.ts` (CRED-01, CRED-02)

```ts
// ENV-1: secrets with special characters do not survive a restart
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
const dir = process.env.GOBLIN_DATA_DIR!;
const { saveEnvVarsGroup, saveEnvVar } = await import("/home/user/goblin-malin/src/utils/envFile.ts");
const cases: Record<string, string> = {
    P_HASH: "abc#123",
    P_SPACEHASH: "abc #123",
    P_QUOTES: '"quoted"',
    P_LEAD: "  padded  ",
    P_SQ: "it's",
    P_NL: "line1\nINJECTED=1",
    P_BACKTICK: "`x`",
    P_DOLLAR: "a$b",
    P_EQ: "a=b",
};
await saveEnvVarsGroup(cases, { name: "Test" });
await saveEnvVar("SOULSEEK_PASSWORD", "p@ss #word");
const text = fs.readFileSync(path.join(dir, ".env"), "utf8");
const parsed = dotenv.parse(text);
for (const [k, v] of Object.entries({ ...cases, SOULSEEK_PASSWORD: "p@ss #word" })) {
    console.log(
        k.padEnd(18),
        JSON.stringify(v).padEnd(24),
        "->",
        JSON.stringify(parsed[k]),
        parsed[k] === v ? "OK" : "**DIFFERENT**"
    );
}
console.log("INJECTED var present:", parsed.INJECTED);
console.log("mode of .env:", (fs.statSync(path.join(dir, ".env")).mode & 0o777).toString(8));
```

### A.2 `r2_task.ts` (DATA-03, RANK-01, RANK-02, FILE-01, SET-01)

```ts
// DT-1: user-typed overrides are wiped by "stopped → start" and by restart. Also RANK-2, FN-1, SET-1.
import fs from "fs";
import path from "path";
const R = "/home/user/goblin-malin/src";
const { notificationScheduler } = await import(`${R}/base/notificationScheduler.ts`);
notificationScheduler.setSyncMode(true);
const { ServiceRegistry } = await import(`${R}/base/service-registry.ts`);
const { MetadataService } = await import(`${R}/flows/musicDownloadFlow/metadataService.ts`);
const { DownloadTask } = await import(`${R}/flows/musicDownloadFlow/utils/downloadTask.ts`);
const { SettingsStore } = await import(`${R}/settings/settingsStore.ts`);
const { globalLogger } = await import(`${R}/base/logger/logger.ts`);
SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
const URL0 = "https://youtube.test/v1";
const meta = {
    id: "v1",
    trackName: "Song (Official Video)",
    artists: [{ type: "artist", name: "ChannelVEVO" }],
    duration: 200000,
    url: URL0,
    uri: "YOUTUBE::TRACK::v1",
    platform: "youtube",
    apiProvider: "youtube",
    fetchedAt: new Date(),
    type: "track",
};
class Yt extends (MetadataService as any) {
    static parseUrl(url: string) {
        const u = new URL(url);
        return u.host === "youtube.test" ? { platform: "youtube", type: "track", id: u.pathname.slice(1) } : null;
    }
    constructor(task: any, logger: any) {
        super("youtube", task, logger);
    }
    async getTrackMetadata() {
        return meta;
    }
    async searchTrack() {
        return [];
    }
}
const metadata = new ServiceRegistry();
metadata.register("youtube", Yt as never);
const mk = (attrs: any) =>
    new DownloadTask({
        id: "t1",
        initialInput: URL0,
        attributes: attrs,
        logger: globalLogger,
        metadataServiceRegistry: metadata,
        discoveryServiceRegistry: new ServiceRegistry(),
        downloadServiceRegistry: new ServiceRegistry(),
        isMetadataServiceEnabled: () => true,
        isDiscoveryServiceEnabled: () => true,
        isDownloadServiceEnabled: () => true,
    });
const base = {
    kind: "track",
    state: "pending",
    userInput: { type: "url", url: URL0 },
    uri: { platform: "youtube", type: "track", id: "v1" },
    recognizedServiceKey: "youtube",
    metadataGroups: [],
    metadataOverride: {},
    downloadSources: [],
    toTag: true,
    toDownload: false,
};

const t = mk({ ...base });
await t.start();
t.setMetadataOverride({ trackName: "Song", artists: [{ type: "artist", name: "Real Artist" }] } as any);
t.setOutputFilename("My name.flac");
console.log("[1] override typed by the user  :", JSON.stringify(t.getAttributes().metadataOverride));
// the user stops the task (e.g. during a download), then presses Run again
t.updateAttributes({ state: "stopped" });
await t.start();
console.log(
    "[1] after stopped -> start      :",
    JSON.stringify(t.getAttributes().metadataOverride),
    "| filename override kept:",
    t.getAttributes().outputFilenameOverride
);
t.setMetadataOverride({ trackName: "Song" } as any);
await t.restart();
console.log("[1] after restart               :", JSON.stringify(t.getAttributes().metadataOverride));

// RANK-2
const { rankResults, calculateResultWeight } = await import(
    `${R}/flows/musicDownloadFlow/services/download-providers/soulseek/ranking.ts`
);
const q = { artistName: "Artist", trackTitle: "Song", extension: "flac", durationMs: 200000 };
const mkRes = (file: string, speed: number, size = 30e6) => ({
    user: "u" + file,
    file,
    size,
    slots: true,
    speed,
    queueLength: 0,
    attribs: {},
});
console.log("[2] weight speed=0              :", calculateResultWeight(mkRes("a\\Artist - Song.flac", 0) as any, q));
console.log(
    "[2] weight radio edit           :",
    calculateResultWeight(mkRes("a\\Artist - Song.flac", 500000) as any, q).toFixed(2)
);
console.log(
    "[2] weight extended mix         :",
    calculateResultWeight(mkRes("a\\Artist - Song (Extended Mix).flac", 500000) as any, q).toFixed(2)
);
console.log(
    "[2] weight karaoke/instrumental :",
    calculateResultWeight(mkRes("a\\Artist - Song (Karaoke Instrumental).flac", 500000) as any, q).toFixed(2)
);
console.log(
    "[2] ranked order                :",
    rankResults(
        [
            mkRes("a\\Artist - Song.flac", 0),
            mkRes("a\\Artist - Song.flac", 500000),
            mkRes("b\\Artist - Song (Extended Mix).flac", 500000),
        ] as any,
        q
    ).map((r: any) => r.file)
);

// FN-1
const { cleanOutputFilename } = await import(`${R}/flows/musicDownloadFlow/utils/cleanOutputDir.ts`);
const { sanitizeFileNamePart } = await import(`${R}/flows/musicDownloadFlow/utils/fileName.ts`);
for (const n of ["NUL", "con", "aux.flac", "COM1", "LPT1.mp3", ".hidden", "a‮b"])
    console.log("[3] filename override", JSON.stringify(n).padEnd(12), "->", JSON.stringify(cleanOutputFilename(n)));
console.log("[3] sanitize 'CON'              :", JSON.stringify(sanitizeFileNamePart("CON")));

// SET-1: a settings write that fails
const dir = process.env.GOBLIN_DATA_DIR!;
fs.mkdirSync(path.join(dir, "settings.json.tmp"), { recursive: true }); // stands for: disk full / read-only folder / locked temp file
try {
    SettingsStore.getInstance().patchMusicSettings({ download: { preferLossless: false } });
    console.log("[4] settings write: no error");
} catch (e: any) {
    console.log("[4] settings write THROWS into the caller:", e.code, e.message.slice(0, 80));
}
process.exit(0);
```

Output:

```
[1] override typed by the user  : {"trackName":"Song","artists":[{"type":"artist","name":"Real Artist"}]}
[1] after stopped -> start      : {} | filename override kept: My name.flac
[1] after restart               : {}
[2] weight speed=0              : -Infinity
[2] weight radio edit           : 3.09
[2] weight extended mix         : 9.27
[2] weight karaoke/instrumental : 3.09
[3] filename override "NUL"        -> "NUL.flac"
[3] filename override "con"        -> "con.flac"
[3] filename override "aux.flac"   -> "aux.flac"
[3] filename override "COM1"       -> "COM1.flac"
[3] filename override "LPT1.mp3"   -> "LPT1.flac"
[3] filename override ".hidden"    -> ".hidden.flac"
[3] sanitize 'CON'              : "CON"
[4] settings write THROWS into the caller: EISDIR EISDIR: illegal operation on a directory, open '.../settings.json.tmp'
```

### A.3 `r3_ytdlp.mjs` (DL-01, DL-07, DL-08)

```js
import { YtDlp } from "ytdlp-nodejs";
const c = new YtDlp({ binaryPath: "/bin/true", ffmpegPath: "/usr/bin/ffmpeg" });
const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz123&index=7";
const dl = c.download(url, {
    paths: "/tmp/x",
    output: "YtDlp YOUTUBE-TRACK-dQw4w9WgXcQ 0000.flac",
    audioFormat: "flac",
    extractAudio: true,
    restrictFilenames: true,
});
const args = dl.getArguments();
console.log(args.filter((a) => !a.startsWith("after_move") && !a.includes("ytdlp-progress")).join(" | "));
console.log(
    "has --no-playlist:",
    args.includes("--no-playlist"),
    "| has --ignore-config/--no-config:",
    args.includes("--ignore-config") || args.includes("--no-config"),
    "| max-filesize:",
    args.includes("--max-filesize")
);
```

### A.4 `r4_orch.ts` (RUN-01, RUN-02)

```ts
const R = "/home/user/goblin-malin/src";
const { notificationScheduler } = await import(`${R}/base/notificationScheduler.ts`);
notificationScheduler.setSyncMode(true);
const { TaskOrchestrator } = await import(`${R}/base/task/orchestrator.ts`);
const { Task } = await import(`${R}/base/task/task.ts`);
const { globalLogger } = await import(`${R}/base/logger/logger.ts`);
const { runAll } = await import(`${R}/flows/musicDownloadFlow/runController.ts`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const started: string[] = [];
class T extends (Task as any) {
    constructor(id: string, state = "pending") {
        super({ id, attributes: { kind: "track", state }, logger: globalLogger });
    }
    async start() {
        if (this.attributes.state !== "pending") return;
        started.push(this.id);
        this.updateAttributes({ state: "running" });
        await sleep(150);
        this.updateAttributes({ state: "finished" });
    }
}
const o = TaskOrchestrator.getInstance();
o.setGlobalMaxConcurrent(1);
// (a) Run all on session A, then the user opens session B while A is still running
o.setTasks([new T("A1"), new T("A2"), new T("A3")]);
void runAll();
await sleep(50);
o.setTasks([new T("B1"), new T("B2")]); // = SessionManager.loadSession(B)
await sleep(800);
console.log("[a] tasks started, in order:", started.join(", "));
console.log(
    "[a] session B tasks states  :",
    o
        .getTasks()
        .map((t: any) => `${t.id}=${t.getAttributes().state}`)
        .join(", ")
);
// (b) a restored session: finished tasks + one pending; Run all
await sleep(200);
const done = [new T("F1", "finished"), new T("F2", "finished")];
done.forEach((t: any) => t.getStatus().set({ type: "success", message: "Saved" }));
o.setTasks([...done, new T("P1")]);
await runAll();
await sleep(500);
console.log(
    "[b] status after Run all    :",
    o
        .getTasks()
        .map((t: any) => `${t.id}:${t.getAttributes().state}:"${t.getStatus().get().message ?? ""}"`)
        .join(" | ")
);
process.exit(0);
```

Output:

```
[a] tasks started, in order: A1, B1, B2
[a] session B tasks states  : B1=finished, B2=finished
[b] status after Run all    : F1:finished:"Queued" | F2:finished:"Queued" | P1:finished:"Queued"
```

(P1 shows "Queued" only because the fake task in the script never sets a status; F1 and F2 are the point.)

### A.5 ffmpeg experiments (TAG-01, TAG-02)

```bash
# a test M4A with a cover picture
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -c:a aac a.m4a
ffmpeg -f lavfi -i "color=c=red:s=64x64:d=1" -frames:v 1 cover.png
ffmpeg -i a.m4a -i cover.png -map 0:a -map 1:v -c:a copy -c:v png -disposition:v attached_pic -metadata title=Old withcover.m4a

# exactly the arguments tagWithFfmpeg builds for .m4a
ffmpeg -hide_banner -nostdin -loglevel error -y -i withcover.m4a -f ipod -map 0:a -c copy \
  -map_metadata -1 -map_metadata:s:a -1 \
  -metadata "title=My Title" -metadata "artist=My Artist" -metadata "album=My Album" -metadata "ISRC=USRC17607839" \
  -movflags use_metadata_tags out.m4a.tagging

ffprobe -v error -show_entries stream=codec_type,codec_name -of csv=p=0 -f mp4 out.m4a.tagging   # aac,audio (the picture is gone)
python3 -c "from mutagen.mp4 import MP4; print(dict(MP4('out.m4a.tagging').tags))"                 # keys are '\x00\x00\x00\x01'...
```

The Opus check is the same idea: add a `METADATA_BLOCK_PICTURE` with mutagen, run the app's arguments (`-f opus -map 0:a -c copy -map_metadata -1 -map_metadata:s:a -1 -metadata TITLE=...`), list the keys again.

### A.6 TUI scenarios (run with `yarn tsx scripts/tui-test/cli.ts <file>`)

DATA-01 (one `R` on a finished track):

```json
{
    "terminal": { "cols": 150, "rows": 40 },
    "dataDir": "scripts/tui-test/fixtures/50-tasks-with-metadata",
    "steps": [
        { "type": "stable", "timeout": 15000 },
        { "type": "key", "key": "Tab" },
        { "type": "stable" },
        { "type": "snapshot", "name": "before" },
        { "type": "key", "key": "r" },
        { "type": "wait", "ms": 1500 },
        { "type": "snapshot", "name": "after-R-1.5s" }
    ]
}
```

SET-01 (settings that cannot be written). The harness skips `*.tmp` entries when it copies a fixture, so the obstacle is created by a small wrapper used as the scenario's `command`:

```bash
#!/bin/bash
# wrap_settings.sh
mkdir -p "$GOBLIN_DATA_DIR/settings.json.tmp"
cd /path/to/goblin-malin && exec yarn -s dev
```

```json
{
    "terminal": { "cols": 120, "rows": 34 },
    "dataDir": "scripts/tui-test/fixtures/empty",
    "command": "bash /path/to/wrap_settings.sh",
    "steps": [
        { "type": "stable", "timeout": 15000 },
        { "type": "key", "key": "ArrowRight" },
        { "type": "key", "key": "ArrowRight" },
        { "type": "key", "key": "ArrowRight" },
        { "type": "key", "key": "Enter" },
        { "type": "stable" },
        { "type": "key", "key": "ArrowDown" },
        { "type": "key", "key": "ArrowDown" },
        { "type": "stable" },
        { "type": "key", "key": "Enter" },
        { "type": "stable" },
        { "type": "key", "key": "Ctrl+S" },
        { "type": "wait", "ms": 2500 },
        { "type": "snapshot", "name": "after-save" }
    ]
}
```

Run with `GOBLIN_TUI_KEEP_DATA=1` and look at `settings.json` and `app.log` in the kept folder.

Other one-liners:

```bash
echo "" | GOBLIN_DATA_DIR=$(mktemp -d) yarn -s dev > out.txt 2>&1        # TTY-01
D=$(mktemp -d); echo $$ > $D/app.pid.lock; GOBLIN_DATA_DIR=$D yarn -s dev  # LOCK-01 (the shell's own pid)
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json   # DOC-01
```

---

## Appendix B: index of all findings

| ID                      | Sev    | Status     | Title                                                                                     |
| ----------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------- |
| 🟢 DONE DATA-01         | High   | Reproduced | `R` on a finished track erases metadata, sources and overrides without confirmation       |
| 🟢 DONE DATA-02         | High   | Reading    | `R` on an album or playlist deletes all its tracks without confirmation                   |
| 🟢 DONE DATA-03         | High   | Reproduced | Three reset paths wipe `metadataOverride` (user data)                                     |
| 🟢 DONE TAG-01          | High   | Reproduced | M4A tags written as `mdta` keys, unreadable by most software                              |
| 🟢 DONE DL-01           | High   | Reproduced | YouTube link with `list=` is given to yt-dlp without `--no-playlist`                      |
| 🟢 DONE CRED-01         | High   | Reproduced | `.env` values not quoted: secrets truncated or altered after restart                      |
| 🟢 DONE RUN-01          | High   | Reproduced | Changing session during "Run all" starts the other session's tasks                        |
| 🟢 DONE BIN-01          | High   | Reading    | Tool updates delete the old binary first; partial download trusted                        |
| 🟢 DONE SET-01          | High   | Reproduced | Failed settings write: no message, no log (handler errors never reach `app.log`)          |
| 🟢 DONE RUN-02          | Medium | Reproduced | "Run all" on a reopened session marks finished tasks "Queued"                             |
| 🟢 DONE RUN-03          | Medium | Reading    | Deleting a running task leaves it running detached                                        |
| 🟢 DONE RUN-04          | Medium | Reading    | Stop does not interrupt the metadata stage; single-track runs bypass cap and Stop         |
| 🟢 DONE NET-01          | Medium | Reading    | No timeout on provider requests or on ffprobe                                             |
| 🟢 DONE SLSK-01         | Medium | Reading    | A failed search destroys the Soulseek client shared by all tasks                          |
| 🟢 DONE SLSK-02         | Medium | Reading    | Each search deletes earlier temp files of the track, even if referenced elsewhere         |
| 🟢 DONE RANK-01         | Medium | Reproduced | "extended" / "club mix" bonus applied to any query                                        |
| 🟢 DONE RANK-02         | Medium | Reproduced | Peers with speed 0 are dropped (`log(0)`)                                                 |
| 🟢 DONE RANK-03         | Medium | Reading    | Query uses the full streaming title, no relaxed retry                                     |
| 🟢 DONE FILE-01         | Medium | Reproduced | Windows device names, hidden names and bidi characters accepted as file names             |
| 🟢 DONE FILE-02         | Medium | Reading    | Shared staging file for two saves to the same destination                                 |
| 🟢 DONE TAG-02          | Medium | Reproduced | Cover art dropped when retagging Ogg, Opus, M4A                                           |
| 🟢 DONE TAG-03          | Medium | Reading    | Re-save tags the library file in place; synchronous `removeTags` on FLAC                  |
| 🟢 DONE DL-02           | Medium | Reading    | End of a download run overrides the user's selection                                      |
| 🟢 DONE DL-03           | Medium | Reading    | In-flight rows and cancel handles are keyed by position                                   |
| 🟢 DONE BIN-02          | Medium | Reading    | Nightly third-party ffmpeg, auto-updated; checksums same-origin and optional              |
| 🟢 DONE BIN-03          | Medium | Reading    | 200 MB archive read and extracted synchronously                                           |
| 🟢 DONE CRED-02         | Medium | Reproduced | `.env` is mode 0644, non-atomic, read-modify-write                                        |
| 🟢 DONE LOCK-01         | Medium | Reproduced | Stale lock with a recycled pid blocks start-up                                            |
| 🟢 DONE TTY-01          | Medium | Reproduced | Without a TTY: "Too many re-renders" and a hang                                           |
| 🟢 DONE CACHE-01        | Medium | Reading    | Cache returns shared objects, dates become strings, unbounded, synchronous persist        |
| 🟢 DONE SET-02          | Medium | Reading    | Esc in a setup wizard disables the provider permanently                                   |
| 🟢 DONE CLAUDE-01       | Medium | Reading    | Loose text matching can trigger a 10-minute "quota" block                                 |
| 🟢 DONE UI-01           | Medium | Reproduced | Task action hints cut at the right edge                                                   |
| 🟢 DONE DATA-04         | Low    | Reading    | Duplicated session shares ids, temp files and saved files                                 |
| 🟢 DONE DATA-05         | Low    | Reading    | Saving from another row deletes a relocated saved file                                    |
| 🟢 DONE DATA-06         | Low    | Reading    | Archiving an album with a busy track splits it                                            |
| 🟢 DONE DATA-07         | Low    | Reproduced | Restart keeps stale Songlink / MusicBrainz cells                                          |
| ⚪ WON'T FIX DATA-08    | Low    | Reading    | Sessions file only grows; temp files outlive their session                                |
| 🟢 DONE DATA-09         | Low    | Reading    | A track cannot belong to two collections                                                  |
| ⚪ NOT A PROBLEM RUN-05 | Low    | Reading    | Links imported during "Run all" start by themselves                                       |
| 🟢 DONE RUN-06          | Low    | Reading    | Metadata slot held while waiting for the user or for Claude                               |
| 🟢 DONE RUN-07          | Low    | To verify  | Primary-metadata fallback queries discovery services with an empty track                  |
| 🟢 DONE DISC-01         | Low    | Reading    | Dead condition, background continuation after skip, `metadataDiscovered` after abort      |
| DL-04                   | Low    | Reading    | yt-dlp: listener leak, pre-aborted signal ignored                                         |
| DL-05                   | Low    | To verify  | yt-dlp: leftovers after failure; ffmpeg child survives on Windows                         |
| DL-06                   | Low    | Reading    | "No cookies file" logged as a warning for every download                                  |
| DL-07                   | Low    | Reading    | yt-dlp reads the user's config; `--js-runtime node`                                       |
| DL-08                   | Low    | Reading    | No size, duration or live-stream limit                                                    |
| DL-09                   | Low    | Reading    | Shorts / live / embed links not recognised; odd ids accepted                              |
| SLSK-03                 | Low    | Reading    | "Lossless" by extension, listening port, unvalidated numbers                              |
| TAG-04                  | Low    | Reading    | Empty album artist; several artists joined into one value                                 |
| TAG-05                  | Low    | Reading    | Retag rename without Windows retry; year-only dates                                       |
| EXIT-01                 | Low    | Reading    | Exit code 0 when the session was not saved                                                |
| EXIT-02                 | Low    | To verify  | yt-dlp / ffmpeg / updater children not killed at exit                                     |
| UPD-01                  | Low    | Reading    | Release page opened with `open()` instead of `openUrl()`                                  |
| UPD-02                  | Low    | Reading    | Installer guess by path substring; update command without timeout                         |
| CLI-01                  | Low    | Reproduced | No `--help` / `--version`                                                                 |
| CLAUDE-02               | Low    | Reading    | Claude CLI runs in the shared temp folder                                                 |
| CLAUDE-03               | Low    | Reading    | All child processes inherit the app's secrets                                             |
| AGENT-01                | Low    | Reading    | Change budget not atomic; parallel async writes on one task                               |
| AGENT-02                | Low    | Reading    | MCP config file in temp; chat and tool log in clear text                                  |
| SEED-01                 | Low    | Reading    | Release id from the redirect trusted if UUID-shaped                                       |
| MPV-01                  | Low    | Reading    | mpv control socket with a predictable name in temp                                        |
| HTTP-01                 | Low    | Reading    | No size or total-time limit on downloads; forgotten User-Agent                            |
| COOKIE-01               | Low    | Reading    | Cookie copy can survive a crash in temp                                                   |
| LOG-02                  | Low    | Reading    | Promise object logged; whole task kept in loggers; settings logged per save               |
| UI-02                   | Low    | Reproduced | Ambiguous-width symbols break the modal border                                            |
| PKG-01                  | Low    | Reading    | Postinstall writes into the user's data folder                                            |
| QUAL-01                 | Low    | Reading    | Dead code (`input-loader.ts`, `useWhyDidYouUpdate.ts`, `withFullScreen`, YouTube getters) |
| QUAL-02                 | Low    | Reading    | Duplicated logic (wizard branches, binary helpers, spawn errors, reset literals)          |
| QUAL-03                 | Low    | Reading    | Synchronous file-system calls in the download and save paths                              |
| QUAL-04                 | Low    | Reading    | Own `setInterval` in `DownloadInProgress` instead of the global ticker                    |
| QUAL-05                 | Low    | Reading    | 71 lint suppressions, 57 double casts, 25 lint warnings                                   |
| QUAL-06                 | Low    | Reading    | 63 files with a BOM, the rest without                                                     |
| TEST-01                 | Low    | Reading    | End-to-end tests not run in CI                                                            |
| DOC-01                  | Low    | Reproduced | `navigate-settings.json` example is not valid JSON for the harness                        |
| DOC-02                  | Low    | Reading    | Stale statements in `TODO.md`, `CLAUDE.md`, `AUDIT-v0.2.1.md`                             |
| DEP-01                  | Low    | Reading    | No npm Dependabot, no audit in CI, known `zod` advisory                                   |

End of document.
