# Goblin Malin — performance audit

|             |                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**    | 2026-11-12                                                                                                                                                                                                                                                                                   |
| **Audited** | `main` @ `72ed579` (package version `0.2.1`)                                                                                                                                                                                                                                                 |
| **Focus**   | Performance first (render cost, scaling with the number of tasks, persistence, timers, install size), plus the other issues found on the way.                                                                                                                                                |
| **Method**  | Static review, then measurements: the TUI harness with `--profile` (existing scenarios plus new idle, mouse and 500/2,000-task scenarios), a CPU profile of the app process, micro-benchmarks of the hot paths, and a timed start of the production build (`dist/cli.js`).                   |
| **Where**   | A Linux cloud container (Node 22.23, no GPU, no Windows Terminal). The headless harness works there: `node-pty` builds and every scenario runs, except the Windows-only `screenshot-powershell` step (see [TOOL-02](#tool-02)).                                                              |
| **Caveat**  | Harness numbers come from the **development** build (`yarn tsx`, React development mode, profiling hooks on). They are good for comparing runs and for counts (commits, renders), but the absolute milliseconds are higher than what users get from `dist/cli.js` (see [TOOL-03](#tool-03)). |

Legend — **Severity**: `high` users will feel it in a normal flow · `medium` felt at scale (hundreds or thousands of tasks, long sessions) or in a common but narrower case · `low` measurable waste with little visible effect · `info` context, not a defect. **Confidence**: `measured` reproduced with numbers below · `verified` proven from the code path · `likely` strong reading, not measured.

---

## 1. Summary

The app is in good shape for its usual size. The task list is virtualised, notifications are coalesced to one per frame, yt-dlp progress is throttled, logs are batched, and the app is idle when nothing happens. Moving through the list costs the same with 50 tasks as with 2,000 (about 11 ms of React work per `↓` in development mode), and the production build shows its first screen in about 0.7 s, even with 2,000 tasks.

What does not scale is **everything that subscribes to every task**, and **the sessions file, which is written in full every time**. They are invisible at 50 tasks and add up at 1,000+. The cheapest large win is the **125 MB of WAV sound effects** shipped in the npm package.

| #   | ID                  | Sev.   | One-liner                                                                                                            |
| --- | ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | [PERF-01](#perf-01) | medium | Three "subscribe to every task" effects are O(N²): 2,000 tasks → ~45 ms blocked per pass, each                       |
| 2   | [PERF-02](#perf-02) | medium | The whole `sessions.json` (every session, every archive) is `JSON.stringify`'d on the main thread on each save       |
| 3   | [PERF-03](#perf-03) | medium | The npm package is 131 MB, 125 MB of it WAV/MP3 sound effects, downloaded again on every update                      |
| 4   | [PERF-04](#perf-04) | low    | The footer repaints the whole screen for every log batch, debug lines included (up to 10 frames/s while downloading) |
| 5   | [PERF-05](#perf-05) | low    | Hidden modals (Sessions, Archive) recompute and re-render on every session save                                      |
| 6   | [PERF-06](#perf-06) | low    | `ink-spinner` runs its own 80 ms timers outside the shared ticker and ignores "animations off"                       |
| 7   | [PERF-07](#perf-07) | info   | An Ink frame always costs the whole screen; `incrementalRendering` does not change that                              |
| 8   | [PERF-08](#perf-08) | low    | Synchronous file-system calls in render and per download                                                             |
| 9   | [TOOL-01](#tool-01) | medium | One unit test fails on Linux, which is why CI still skips the unit tests on ubuntu                                   |
| 10  | [TOOL-02](#tool-02) | low    | The harness crashes on any non-Windows machine when a scenario has `screenshot-powershell`                           |
| 11  | [TOOL-03](#tool-03) | low    | Profiling only covers the development build, and there is no large-session fixture or scale scenario                 |

| Area                      | high | medium |   low |  info |  total |
| ------------------------- | ---: | -----: | ----: | ----: | -----: |
| Performance (`PERF-`)     |      |      3 |     4 |     1 |      8 |
| Tests & tooling (`TOOL-`) |      |      1 |     2 |       |      3 |
| **Total**                 |    0 |  **4** | **6** | **1** | **11** |

Plus a few unconfirmed leads in [section 4](#4-candidates-not-confirmed).

---

## 2. Findings

### A. Performance

<a id="perf-01"></a>

#### PERF-01 — Three "subscribe to every task" effects are O(N²)

- **Severity:** medium · **Confidence:** measured
- **Where:**
    - `src/components/App.tsx:108-117`: persists the session on any task change;
    - `src/components/PromptModal/useActivePrompt.ts:24-48`;
    - `src/components/SetupWizardModal/useActiveWizardPrompt.ts:30-46`.
- **What:** each effect runs `tasks.map(task => task.subscribe(...))` and runs again whenever the task **array** changes (an import, a playlist expanding, a removal, an archive, a session switch; for the two prompt hooks also every collapse/expand and every change on a collection task, because they get `visibleTasks`, which `App` rebuilds through `collapseVersion`). `Task.subscribe()` **calls the callback immediately** (`src/base/task/task.ts:139-145`), and each callback costs O(N):
    - `App`: `manager.persistCurrent(orchestrator.getTasks().map((t) => t.get()))` builds an N-entry array and resets a timer;
    - `useActivePrompt` / `useActiveWizardPrompt`: `tasks.find(...)` / a loop over every task, as long as no prompt is open.

    So **re-subscribing costs N × N**. After that, **every notification of one task costs O(N)** in each of the three, and a frame where many tasks change (a "Run all" start or stop, `clearQueuedStatus`, a restore) costs N × N again.

- **Measured** (`App`'s effect alone, with the real `Task` and `notificationScheduler`):

    | Tasks | Re-subscribe | One frame where every task changed | Snapshot entries built |
    | ----: | -----------: | ---------------------------------: | ---------------------: |
    |   200 |       2.2 ms |                             1.5 ms |                 80,000 |
    |   500 |       6.6 ms |                             6.5 ms |                500,000 |
    | 1,000 |      19.3 ms |                            17.0 ms |              2,000,000 |
    | 2,000 |      44.6 ms |                            44.9 ms |              8,000,000 |

    The two prompt hooks have the same shape, so in total it is about 3× this per pass. The real `persistCurrent` also does a `clearTimeout` and a `setTimeout` per call. Importing a 1,000-track playlist on top of a 1,000-task session costs about a tenth of a second of blocked UI per array change.

- **Fix:**
    1. Persist: subscribe **once**, to "some task changed", instead of N times. For example, the orchestrator (or the `notificationScheduler` flush) emits one `tasksChanged` event per frame, and `persistCurrent` takes no argument and reads `orchestrator.getTasks()` **when the debounce fires**, not on every change. The snapshot array is then built once per write instead of once per change.
    2. Prompts: keep a set of "tasks with a pending prompt" fed by `TaskPrompt` itself (it already notifies on change), so finding the active prompt is O(1) and needs no per-task subscription. Both modals can share it.
    3. If per-task subscriptions stay anywhere, add a `subscribe(cb, { immediate: false })` option so a re-subscription does not replay N callbacks.

<a id="perf-02"></a>

#### PERF-02 — The whole sessions file is serialised on the main thread on every save

- **Severity:** medium · **Confidence:** measured
- **Where:** `src/sessions/sessionStore.ts:139-166` (`flushToDisk`), `src/sessions/sessionManager.ts:99-174` (`persistCurrent` → `_doPersist`).
- **What:** while anything changes, the current session is saved at most 0.8 s after the last change and at least every 5 s (`DEBOUNCE_MS = 800`, `MAX_WAIT_MS = 5000`). Each save runs `JSON.stringify(snapshot)` on the **whole** `SessionsFile`: every session the user ever kept, with every archived task and every task's full metadata and download-source lists. Only the `writeFile`/`rename` are asynchronous. The stringify is synchronous on the UI thread, so the class comment "each off the main thread" is only half true. The same file is also parsed whole and synchronously, during the first React render that touches the store (the hidden `SessionsModal`, see PERF-05).
- **Measured:** the `50-tasks-with-metadata` fixture is about 2.3 KB per task with metadata only, without download sources. Scaled up:
    - 2,000 tasks → 4.6 MB file;
    - 20 sessions × 300 tasks → 13.9 MB, `JSON.stringify` **66 ms**, `JSON.parse` 79 ms.

    Tasks with Soulseek/yt-dlp candidates are bigger. During a long run, that is a 20–70 ms freeze every 0.8–5 s, and it grows with sessions the user is not even looking at.

- **Fix** (from simplest to most thorough):
    - stringify only what changed: keep each session's serialised JSON cached and rebuild the file text from those pieces, so an unchanged session costs a string concatenation;
    - better, **one file per session** (`sessions/<id>.json` plus a small index), so a save writes only the current session and start-up parses only the index and the last session;
    - optionally move the stringify and write to a `worker_threads` worker (the snapshot is already plain data).

    Also, `_doPersist` calls `setLastSessionId` on every save even when the id has not changed. That emits a second `change` event to every store listener (see PERF-05).

<a id="perf-03"></a>

#### PERF-03 — The npm package is 131 MB, almost all of it sound effects

- **Severity:** medium · **Confidence:** measured
- **Where:** `src/assets/sounds/` (62 files, copied to `dist/assets` by `tsup.config.ts`); `npm view goblin-malin dist.unpackedSize` = **131,246,346 bytes** for `0.2.1`.
- **What:** `dist/assets/sounds` is 125 MB. The two largest files are most of it:
    - `intro/DroneDemonic_BW.12015.wav`: **53.5 MB**, PCM 24-bit, 96 kHz stereo, 93 s. It is cued twice in the intro (`introSounds.ts:175`, `:294`), first only for about 1 s;
    - `intro/outro.mp3`: **20.2 MB**, 320 kb/s, **8 min 24 s**, cued once for the finale (`introSounds.ts:147`).

    Every user downloads this on install, and the self-update downloads it again for every version. On a slow line that is minutes. It is also unpacked into the global `node_modules` every time.

- **Fix:** convert the effects to Opus or Ogg Vorbis at 48 kHz (mpv plays both). Trim the drone and the outro to the part the intro actually plays. Expect the whole folder to fit in a few MB. A size budget in CI (fail if `npm pack --dry-run` reports more than, say, 15 MB) keeps it from coming back. (The licence of the samples is already tracked in `AUDIT-v0.2.1.md`, DOC-07.)

<a id="perf-04"></a>

#### PERF-04 — The footer repaints the screen for every log batch, debug lines included

- **Severity:** low · **Confidence:** verified
- **Where:** `src/components/Footer.tsx:22-30`; `src/base/logger/ink-transport.ts` (100 ms batches); `YtDlpService.ts:244-263` forwards **every** yt-dlp stdout/stderr line as a `debug` log.
- **What:** the footer subscribes to every log batch and calls `setLastLog`/`setLogCount` regardless of level. While a download runs there is a batch every 100 ms, so **up to 10 commits per second**, each a full Ink frame (PERF-07), even when nothing on screen should change. Because it does not filter by level, the footer also shows `[DEBUG] …` lines although Settings → Logs → level is `info` by default (a small UX bug).
- **Fix:** filter by `settings.logs.logLevel` before `setState`, and skip the update when the visible text is unchanged. Optionally, throttle the footer to 2–4 updates per second.

<a id="perf-05"></a>

#### PERF-05 — Hidden modals recompute and re-render on every session save

- **Severity:** low (medium for users with many large sessions) · **Confidence:** measured
- **Where:**
    - `src/components/SessionsModal/useSessions.ts`, called at `SessionsModal.tsx:45`, before `if (!isVisible) return null` (`:250`);
    - `src/components/ArchiveModal/useArchive.ts` (`useCurrentSession` + `buildArchivedEntries`);
    - the toolbar's `useArchivedCount` and `useCurrentSessionName`.
- **What:** the modals are always mounted, and their hooks run whether they are open or not. Each session save emits `change` on the store, sometimes twice (PERF-02), so `useSessions` re-sorts and re-filters every session, `useArchive` rebuilds the archive list, and both modals plus the toolbar re-render, while closed. The profiles show it:
    - with **2,000 tasks**, `SessionsModal` reaches **41 ms p95** at boot. This includes parsing `sessions.json` synchronously inside the first render that touches the store;
    - `PromptModal` takes 13 ms (PERF-01);
    - in the idle 50-task run, `SessionsModal` renders 3× while closed.
- **Fix:** move the hooks into an inner component that is mounted only when the modal is visible (`{isVisible && <SessionsModalBody … />}`), the same for `ArchiveModal`. The toolbar badge only needs a count. Have the manager expose `archivedCount` and the current name (updated in `_doPersist`/archive/restore) instead of re-reading the session on every change. Load `sessions.json` in `SessionManager.init()` (an effect), not lazily during a render.

<a id="perf-06"></a>

#### PERF-06 — `ink-spinner` bypasses the shared animation ticker

- **Severity:** low · **Confidence:** verified
- **Where:** `src/components/SecondaryPanel/MetadataPanel/Uri.tsx:3,33` and `MetadataSourceList.tsx:3`.
- **What:** every other spinner goes through `useGlobalTicker` (one 125 ms master timer, one commit per tick, off when animations are disabled). `ink-spinner` starts its **own** `setInterval` at 80 ms per instance (`node_modules/ink-spinner/build/index.js`). So while a metadata source is loading in the lower panel, the screen repaints about 12 times per second on a schedule unrelated to the row spinners' 8/s, and **Settings → Animations off has no effect on it**.
- **Fix:** replace `<Spinner type="dots" />` with `<AnimatedIcon icon={Icon.Dots} interval={80} />` (same frames), then drop the `ink-spinner` dependency.

<a id="perf-07"></a>

#### PERF-07 — An Ink frame always costs the whole screen

- **Severity:** info · **Confidence:** measured
- **What:** in a CPU profile of the app during `scroll-task-list-fast` (128×64, development build), the largest single cost after start-up is Ink's output stage. `@alcalzone/ansi-tokenize` (tokenise and diff of each styled line) takes **533 ms of 3.1 s busy**, more than React (247 ms) and the reconciler (175 ms); Yoga layout is only 49 ms. Ink rebuilds and re-tokenises the full screen on every frame: **30–45 ms per frame** in these runs, whatever changed. I tried Ink 8's `incrementalRendering: true` (A/B, two runs each): total Ink time went from 1,063/1,048 ms to 1,019/983 ms, i.e. no meaningful change, because it only reduces bytes written, not the per-frame work.

    Practical consequences:
    - **the number of frames is the budget**. Every extra commit (PERF-04, PERF-06, a hidden modal re-rendering) costs a full frame;
    - moving the task cursor costs **2 commits** (cursor, then the lower panel catching up). They usually share a frame, but not always (the scroll runs alternate 2/0 commits);
    - the number of styled `Text`/`Box` nodes on screen is the other lever. A `↓` in the list renders about 820 `Box` and 680 `Text`, most of them in the lower panel (`FieldRow` ×20, `Uri`).

- **Suggestions:** keep the count of frames per interaction as the metric (the harness already reports it). Consider `concurrent: true` with `useDeferredValue` for the lower panel so fast key repeat is not slowed by it. Check how many styled segments the metadata/download panels produce per row. Do not enable `incrementalRendering` for speed: it may still help on slow remote terminals, but that was not measured.

<a id="perf-08"></a>

#### PERF-08 — Synchronous file-system calls in render and per download

- **Severity:** low · **Confidence:** verified
- **Where:**
    - `ArchiveModal.tsx:445`: `fs.existsSync(entry.filePath)` for **each visible row on every render**;
    - `DownloadSourceDetail.tsx:1186`: `fs.existsSync(outputDir)` on every render;
    - `tempFile.ts:58,72,93`: `readdirSync` of the **whole** temporary download folder. It runs once per download in `findExistingTempFile` and up to twice more after it in `listTempFilesWithStem`, from `YtDlpService.ts:283,290`, plus once in Soulseek's `deleteExistingTempFiles`.
- **What:** each call is fast on a local SSD, but they block the UI thread. They get slow on a network drive, a USB disk, an antivirus-scanned folder, or a temp folder holding thousands of files (it fills up until cleaned, see DATA-08 in `AUDIT-v0.2.1.md`). With 4 parallel downloads, the temp folder is listed about 12 times per round of tracks.
- **Fix:** compute file existence in an effect (`fs.promises.access`) and keep it in state. For temp files, list the folder once (`fs.promises.readdir`) and pass the list, or derive the exact file name (the stem is known) and `stat` it instead of listing.

### B. Tests & tooling

<a id="tool-01"></a>

#### TOOL-01 — One unit test fails on Linux; CI skips the unit tests on ubuntu

- **Severity:** medium · **Confidence:** measured
- **Where:** `tests/unit/savedSource.test.ts:71-75`; `.github/workflows/ci.yml` ("The unit tests are only run on Windows for now … Drop the `if` once they are green on ubuntu too").
- **What:** `yarn test` on Linux gives **1 failed, 572 passed, 11 skipped**. The failing test expects `C:\Music\Mode avion.flac` and `C:/Music/Mode avion.flac` to be the same file on every platform. On POSIX a backslash is an ordinary file-name character, so `samePath` (`computeOutputPath.ts:23`) correctly says they are different. The code is right; the test is Windows-only. This is the **only** failure, so it is the only thing keeping the unit tests (and coverage) off the ubuntu CI job.
- **Fix:** make the expectation platform-aware: on POSIX compare `/music/a.flac` with `/music/./a.flac` (separator normalisation) and expect `[]` for the backslash case, or `test.runIf(process.platform === "win32")`. Then remove the `if: runner.os == 'Windows'` from the CI step. The e2e and render-profile tests (`tests/e2e/`) passed here too and are not run in CI at all; they could join the ubuntu job.

<a id="tool-02"></a>

#### TOOL-02 — The harness crashes when a scenario uses `screenshot-powershell` on Linux/macOS

- **Severity:** low · **Confidence:** measured
- **Where:** `scripts/tui-test/runner.ts:98` (`spawnSync("powershell.exe", …)`), reached through `scripts/tui-test/examples/scroll-task-list.json`.
- **What:** on Linux the step throws an unhandled `'error'` event (`spawn powershell.exe ENOENT`), and the whole run ends with exit 1 and no result. The README marks the step as "Preferred for visual validation", so scenarios written on Windows can't run anywhere else, including the cloud and the ubuntu CI job.
- **Fix:** on a non-Windows platform, fall back to the built-in emulator `screenshot` with a warning, or skip the step and record it as skipped.

<a id="tool-03"></a>

#### TOOL-03 — Profiling covers only the development build, and nothing exercises a large session

- **Severity:** low · **Confidence:** verified
- **What:**
    - the harness always starts `yarn dev` or `yarn tsx src/profiling/profiledEntry.tsx` (`runner.ts:80`): React in development mode, on-the-fly transpilation, profiling hooks on. The `ms` numbers in every profile are therefore higher than what users get (the comment in `src/cli.ts` estimates 1.5–2×), and nothing measures the shipped bundle;
    - the largest fixture is 50 tasks. PERF-01, PERF-02 and PERF-05 only show at hundreds or thousands of tasks, and no test would catch a new O(N²);
    - the `Toolbar` "slow-component" warning (20–27 ms p95) appears in every run. It is a one-time cost at boot (first `string-width` call: 33 ms to import, 19 ms for the first emoji measurement), so the warning is noise that hides real ones.
- **Fix:**
    - add a fixture generator, e.g. `scripts/tui-test/fixtures/generate.mjs --tasks 2000` (this audit used a 10-line script that copies the 50-task fixture with fresh ids);
    - add a `scale-2000` profile scenario with a **render-count** baseline (machine-independent), plus unit-level benchmarks for `persistCurrent` and the prompt lookup that assert linear growth;
    - optionally let a scenario set `"command": "node dist/cli.js"` for timing runs;
    - exclude the boot interaction from `slow-component`, or raise its threshold for boot only.

---

## 3. Verified OK (measured, no problem)

- **Idle is idle.** 10 s with nothing happening (`empty`, `50-tasks`, `50-tasks-with-metadata`): no commits after the last key apart from the start-up maintenance. No timer runs when nothing animates.
- **The task list is virtualised.** Only the visible rows render, and the cost of navigation does not grow with the list: ~11 ms of React work and 1–2 commits per `↓` at 50, 500 and 2,000 tasks (development build). `Ctrl+A` on 2,000 tasks: 23 ms. Switching view mode (`2` → `1`): 36–52 ms.
- **Mouse motion is cheap.** With any-event tracking on, 100 motion reports over the task list and toolbar produced **0** commits.
- **Coalescing works.** `notificationScheduler` (one flush per 16 ms), the shared 125 ms animation ticker, 100 ms log batches, bounded log buffers and row cache (2,000 / 4,000 entries), and yt-dlp progress published only on a whole-percent change or every 500 ms.
- **Production start-up.** `node dist/cli.js` shows the first byte after ~0.57 s and the first full screen after **0.70–0.85 s**, both with an empty data folder and with a 2,000-task, 4.6 MB `sessions.json`.
- `NODE_ENV` defaults to `production` in the published binary (`src/cli.ts`), so users get React's production build.
- `getAppSettings()` costs about 1 µs (it deep-merges a small object on each call), so calling it in render is fine.
- No render cascades (the `error`-severity anomaly) in any scenario run, and `profile-navigate` has no baseline regression.
- `yarn type-check` passes; `yarn lint` passes with 0 errors (10 `no-explicit-any` warnings in `tests/unit/*`); `yarn build` passes.

## 4. Candidates (not confirmed)

- With 2,000 tasks, `InputRouter` reaches 45 ms p95 at boot (it is under 10 ms at 50 and 500 tasks). Its render does not visibly loop over the tasks unless several are selected, so the cause was not isolated. It may be GC attributed to it, or the first `buildContextualActionBar` on a large list. Worth a look with the 2,000-task fixture.
- `InkTransport.log` runs a `setImmediate` per log line and `history.splice(0, 1)` per line once the 2,000-entry ring is full (an O(2,000) shift each). This is negligible today, but a fixed-size circular buffer would remove it.
- The in-memory log keeps live `Task` references (up to 2,000 entries), which keeps deleted tasks and their attributes in memory until the entries rotate out. It is bounded, but at 2,000 tasks with download sources this may be tens of MB.
- The section-K leads of `AUDIT-v0.2.1.md` were not re-checked, except "`App.tsx`: per-task `subscribe(...persistCurrent)` → O(N²)", which is confirmed and measured here as **PERF-01**.

## 5. Coverage & limits

- **Harness in the cloud:** yes, it works. `yarn install` builds `node-pty`, and the headless xterm runs every scenario and `--profile`. Not available here: `screenshot-powershell` (Windows Terminal), and real audio (`GOBLIN_NO_AUDIO=1`).
- **Not exercised:** a real network pipeline (no Spotify/YouTube/Soulseek calls were made; downloads, tagging and conversion were not timed), memory over a multi-hour run, Windows-specific costs (ConPTY, Defender scanning the temp folder), slow terminals over SSH, and `GOBLIN_SLOW` (it uses Windows process priority/affinity).
- The scale fixtures were the 50-task fixture repeated with fresh ids. They have metadata but no download sources and no collections, so real sessions are larger (PERF-02) and collapse/expand paths (PERF-01) were reasoned about, not profiled.
- Scenarios, fixtures, profiles and benchmarks used here were kept out of the repository. Nothing in `src/` was changed (the `incrementalRendering` A/B was a temporary edit, reverted).
