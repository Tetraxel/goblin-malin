# P20 — Performance & Scalability Roadmap

## Goal

P19 fixed keystroke-time React cost (memoized cells, sliced focus contexts, deferred
secondary panel): scroll went from ~24 ms React / keystroke to ~4 ms with 0 wasted
renders. What remains is everything that makes the app feel slow **outside** of a
single keystroke — and everything that will collapse when the app scales to hundreds
of tasks, more providers, and more parallel downloads. This document is the
investigation result: every remaining cost, ranked, with the fix for each — including
the radical options and when they become worth it.

## The mental model

Ink repaints the **whole tree** on every React commit: Yoga layout over every node +
render-to-string + ANSI line diff (~13 ms measured on the 50-task fixture, dev mode).
So the app's fluidity is governed by one number:

> **commits per second × ~13 ms = fraction of the main thread burned on repaints.**

A keystroke that arrives while a repaint is in flight waits. Latency therefore isn't
caused by input handling (dispatch is synchronous and cheap) — it's caused by
*background commit pressure*. Today that pressure comes from three sources: download
progress events, spinner animations, and log traffic. All three grow linearly with
task/download count, which is exactly the scaling axis the product wants to grow on.

---

## Findings

### F1 — Unthrottled download progress is the #1 commit source 🔴

`YtDlpService.downloadTrack()` ([YtDlpService.ts](../../../src/flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService.ts))
does, on **every** yt-dlp progress event:

1. `this.status.update({ progress })` → notifies task subscribers → commit
2. `onUpdate(...)` → `downloadTask` `updateAttributes({ downloadSources: [...downloadSources] })`
   → second notification, **new array identity** (defeats every memo downstream)
3. `this.logger.debug(...)` → InkTransport notification + Winston file write

yt-dlp emits progress per stdout line — easily 5–15 events/s per download. With 3
parallel downloads that is ~20–50 notification bursts/s; at the "way more parallel
downloads" target it saturates the main thread with repaints alone.

Compounding it, `TaskStatus.update()` ([task-status.ts](../../../src/base/task/task-status.ts))
**notifies unconditionally** — no equality check. A progress tick from 42.31 % to
42.35 % renders identically (the cell shows an integer) but still costs a full commit.

**Fix (cheap, huge win):**
- Quantize progress to integer percent and bail in `TaskStatus.update()` when the
  merged attributes are shallow-equal to the previous ones.
- Coalesce `onUpdate` attribute writes per task through a ~100 ms trailing throttle
  (progress is the only field that changes mid-download).
- Route the per-event `logger.debug` through a sampler (e.g. log every 10 % step),
  or drop it to a level the InkTransport doesn't subscribe to.

Expected result: progress commit pressure drops from O(events) to ≤10 commits/s
*total* regardless of download count. This single finding is most of "the app is
slow while downloading".

### F2 — Spinners force a permanent repaint loop 🔴

- `ToolbarButtonInvoker` renders `<AnimatedIcon interval={80}>` while a button is
  busy → **12.5 full-frame repaints/s** for the entire duration of a run.
- `StatusCell` renders `<AnimatedIcon interval={200}>` per processing/pending row
  → 5 repaints/s on a separate timer (the two intervals don't share ticks).

Combined: ~17.5 commits/s ≈ **~23 % of the main thread** spent on Yoga+diff while
anything is running — before a single progress event. This is the idle-cost floor
users feel as "the app is kind of slow".

**Fix:**
- One shared animation cadence (250 ms is plenty for terminal spinners): make
  `useGlobalTicker` snap all intervals to multiples of one base timer so all
  spinner updates land in the **same** React batch → 4 commits/s total.
- Drop the 80 ms toolbar spinner to the shared cadence.
- Optional polish: pause spinner ticks entirely when `animationsEnabled` is off
  (today `AnimatedIcon` still subscribes to the ticker and re-renders; it just
  shows frame 0 — the setting saves nothing).

### F3 — The log pipeline is unbounded and O(history) per entry 🟠

[ink-transport.ts](../../../src/base/logger/ink-transport.ts) — the `maxLogs: 300`
option is passed but **never enforced**; `history` grows without bound for the
process lifetime. [LogPanel.tsx](../../../src/components/SecondaryPanel/LogPanel.tsx)
mirrors that into component state (`setLogs(prev => [...prev, ...batch])` — also
unbounded) and then, on every new entry, re-filters **all** logs and re-runs
`formatLogRows` over the **entire** history (`allRows` flatMap keyed on `filteredLogs`
identity, which changes on every append). A long download session with debug logging
turns every log line into an O(total-logs) reformat + a commit.

Winston also writes every debug line to `app.log` — fine on its own, but F1 makes
it fire per progress event.

**Fix:**
- Enforce a ring buffer (e.g. 1 000 entries) in `InkTransport`; same cap in LogPanel
  state.
- Batch transport notifications on a ~100 ms tick instead of per-entry.
- Cache formatted rows per log id (append-only cache keyed on `log.id` + width) so
  a new entry formats only itself.

### F4 — Session persistence rewrites the world, synchronously 🟠

[sessionStore.ts](../../../src/sessions/sessionStore.ts) `writeToDisk()` does a
`JSON.stringify(allSessions, null, 2)` + `fs.writeFileSync` of **every session ever
saved** on each flush — on the main thread. Task snapshots carry full metadata from
every provider, so this file grows with library size × session count; a 5 MB
stringify+write is a visible input stall.

The debounce in [sessionManager.ts](../../../src/sessions/sessionManager.ts) is
trailing-only and **reset on every call** — during continuous activity (orchestrator
notifies + per-task subscriptions in `App.tsx` fire constantly while running) it can
starve for the whole run, then land one big synchronous write. Two problems in one:
no durability during the run, and a stall when it finally fires.

**Fix:**
- One file per session (write only the dirty one), compact JSON, async
  `fs.promises.writeFile` + atomic rename.
- Add a max-wait to the debounce (flush at least every ~5 s of sustained activity).
- Longer term (scale): move sessions to SQLite (or an append-only JSONL journal) —
  constant-time updates regardless of session count, and crash-safe mid-run.

### F5 — The orchestrator polls and scans 🟠

[flow-orchestrator.ts](../../../src/base/flow/flow-orchestrator.ts):
- `processTasks()` wakes every **100 ms** and calls `notifySubscribers()` at least
  twice per iteration whether or not anything changed — a permanent 10–20
  notifications/s heartbeat into React and into the `App.tsx` persist subscriber
  while running.
- `getTasksCandidates()` / `getTasksInProgress()` are O(n) filters run several times
  per iteration; `addTasks()` is O(n²) (a `find` per added task).
- `maxConcurrentTasks` on the flow is declared but ignored — only the hardcoded
  `globalMaxConcurrent = 3` exists. "Way more downloads in parallel" currently means
  editing a constant, and there's no way to give metadata fetches and downloads
  different budgets.
- ~350 lines of the file are commented-out dead code — worth deleting on touch.

**Fix — event-driven scheduler (no behavior change to flows):**
- Replace the polling loop with completion-driven dispatch: when a task settles,
  fill free slots immediately. Zero wakeups when idle, zero no-op notifications.
- `Map<string, Task>` for identity; O(1) add/remove.
- Per-flow *and* per-stage concurrency budgets (e.g. `metadata: 4`, `download: N`
  user-configurable) with the global cap on top. This is the piece that actually
  unlocks "more platforms, more parallel downloads" — network-bound downloads can
  scale to dozens while CPU-bound stages stay bounded.
- Notify only on real transitions (started / finished / added / removed).

### F6 — Notification fan-out has no batching layer 🟡

Every `Task.updateAttributes` / `TaskStatus` change synchronously walks subscriber
sets → `setState` in every subscribed component + the `App.tsx` session-persist
subscriber, which re-snapshots **all** tasks (`orchestrator.getTasks().map(t => t.get())`)
per event. React batches same-tick setStates, but bursts from different async events
(3 downloads' stdout handlers) each get their own commit. P19 also left a known
"two commits per keystroke" from the shortcut-registry pub-sub landing outside
React's batch.

**Fix:** a single notification scheduler — dirty-task set + one flush per frame
(`setImmediate` or 16 ms cap) that delivers all pending notifications in one batch →
one commit per frame, no matter how many tasks changed. This also collapses the
shortcut-registry second commit if its notify goes through the same flush. This is
the structural guarantee that N parallel downloads produce O(1) commits per frame,
not O(N).

### F7 — React runs in development mode everywhere 🟡

Nothing sets `NODE_ENV`: not `yarn dev` (tsx), not [tsup.config.ts](../../../tsup.config.ts)
(no `define`, react externalized), not [cli.ts](../../../src/cli.ts). React 19's dev
build (extra invariants, double-checks) is what users run in the published package.
Dev-mode React is typically 1.5–2× slower per render than production.

**Fix (one-liner class):** `define: { "process.env.NODE_ENV": '"production"' }` in
tsup (or set it at the top of `cli.ts` before importing React), keep dev mode for
`yarn dev`. Free speedup on every commit for end users.

### F8 — Ink's full-tree repaint is the final floor 🟡

After F1–F7, the cost of *one* commit (~13 ms dev / less in prod) is the ceiling on
fluidity. Levers, in escalating order of effort:

1. **Node-count reduction** (already flagged in P19): flatten per-row Box nesting,
   merge adjacent `<Text>` segments (LogPanel renders one `<Text>` per colored
   segment per row; TaskRow wraps every cell in a fixed-width Box). Yoga cost is
   linear in node count — halving nodes halves the floor.
2. **Lower `maxFps`** under load (Ink option, currently 60): a dynamic 30 fps cap
   during download storms halves worst-case repaint spend with no perceptible loss
   in a terminal. Keep 60 when idle for crisp input echo.
3. **Radical — split engine from UI.** Move flows/orchestrator/services into a
   worker thread or child process ("engine"); the TUI process holds only snapshots
   and receives coalesced deltas over IPC at a capped rate. GC pauses, JSON
   serialization (F4), tagging/FS work can never again block a keystroke; the engine
   can run hundreds of tasks. This is the right long-term shape for the scalability
   target — and it's *also* the feature that later enables a detached daemon
   (downloads keep running when the TUI closes) — but it's a multi-week
   restructuring. Do it only after F1–F6, measured, still isn't enough.
4. **Radical — leave Ink** (custom ANSI renderer, or notcurses/ratatui-style core):
   only worth discussing if a profiler shows Yoga+diff still dominating after node
   reduction *and* the engine split. The whole component library, focus system, and
   test harness are Ink-shaped; this is a rewrite, not an optimization. Not
   recommended on current evidence.

### Minor observations (fix on touch)

- `TaskStatus.get()` allocates a fresh object per call (called in every `Task.get()`
  rebuild); could return a frozen cached copy.
- `Logger.log()` does `crypto.randomUUID()` + object spreads per entry — noise once
  F1/F3 land, measurable before.
- `useShortcuts` rebuilds entries and reads `SettingsStore` on **every render** of
  every consumer (`shortcutRegistry.update` per render). Cheap individually; a
  version-keyed memo would drop it to near-zero.
- `App.tsx` re-subscribes to every task (`tasks.map(task => task.subscribe(...))`)
  whenever the `tasks` array identity changes, and `subscribe()` fires the callback
  immediately → N immediate `persistCurrent` calls per list change.
- The startup `init.wav` play and the `fs.writeFileSync(logsPath, "")` truncation are
  boot-time only — harmless.

---

## Prioritized plan

| Phase | Items | Effort | Expected effect |
| ----- | ----- | ------ | --------------- |
| **P0 — stop the bleeding** | F1 (throttle+dedupe progress), F2 (shared 250 ms tick), F3 (ring buffer + batched log notify), F7 (prod NODE_ENV) | ~1–2 days | Background commits drop from ~20–50/s to ≤5/s while downloading; each commit ~1.5–2× cheaper for end users. This is most of the perceived latency. |
| **P1 — structural correctness** | F6 (notification scheduler → 1 commit/frame), F5 (event-driven orchestrator + per-stage concurrency), F4 (per-session async writes + max-wait) | ~1 week | O(1) commits per frame regardless of parallelism; no polling heartbeat; no sync-write stalls; concurrency becomes a user setting. Unlocks the scale target. |
| **P2 — lower the floor** | F8.1 (node-count reduction), F3 row cache, F8.2 (adaptive maxFps) | ~1 week, incremental | Halves the per-commit cost; keeps worst case bounded. |
| **P3 — radical, evidence-gated** | F8.3 engine/UI process split; (F8.4 renderer swap only if proven necessary) | multi-week | Hard guarantee: UI thread never blocked by engine work; hundreds of parallel tasks; enables detached daemon mode. |

## Measurement (use what P17/P18 built)

- Add a **download-storm scenario** to the harness: a fake download service emitting
  progress at 10 events/s × 5 tasks (fixture, no network). Profile before/after each
  P0/P1 item; assert a `commits-per-second` budget the same way `commit-cascade`
  already fails CI.
- Track the two axes separately per the P18 profiler: React ms (should collapse with
  F1/F2/F6) and Ink frame count (should collapse with F6, then shrink with F8.1).
- Keep the FPS overlay (`GOBLIN_SLOW=1` work) as the live sanity check.

## Non-goals

- Micro-optimizing cell render bodies — P19 already made them memo-bail correctly;
  the cost is not there anymore.
- Replacing React/Ink pre-emptively (see F8.4 — evidence-gated only).
