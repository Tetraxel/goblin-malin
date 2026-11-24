# TUI Test Harness

Headless scenario runner for validating user flows and visual appearance without running the app manually.

## Running a scenario

```bash
# Machine-readable output (JSON with snapshots + metrics)
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json

# Human-readable: live event stream + inline ANSI snapshots
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json --pretty
```

```bash
# Every scenario of examples/ (not perf-* / profile-*), a few at a time, one pass/fail line each
yarn tsx scripts/tui-test/cli.ts --all [--filter a,b] [--parallel 2] [--include-perf] [--screenshots] [--json]

# Compare with (or, with --update-golden, write) the golden files of assertSnapshot steps
yarn tsx scripts/tui-test/cli.ts <scenario.json> [--update-golden]

# One app kept running between commands: press a key, read the screen, decide
yarn tsx scripts/tui-test/sessionCli.ts start
```

`--pretty` is best for interactive debugging. Plain JSON is best for automated validation — parse `result.snapshots["name"].plain` to assert on screen content. In your own tests, call `runScenario(scenario)` (`runner.ts`): it throws a `ScenarioFailure` when a step fails.

## Scenario file format

Scenarios are JSON files in `scripts/tui-test/examples/`.

```jsonc
{
    "terminal": { "cols": 128, "rows": 64 }, // optional, defaults: 200×50
    "dataDir": "scripts/tui-test/fixtures/empty", // optional: sets GOBLIN_DATA_DIR
    "scale": { "tasks": 2000 }, // optional: grows the copy of the fixture (see "Large sessions")
    "load": { "tasksPerTick": 40 }, // optional: synthetic activity for startLoad steps
    "settings": { "logs": { "logLevel": "INFO" } }, // optional: deep-merged into the copy's settings.json
    "network": { "rules": [{ "url": "api.deezer.com/track/1", "json": {} }] }, // optional: fake network (see "Fake network")
    "clipboard": "https://…", // optional: what is on the (stand-in) clipboard at start (see "Clipboard")
    "command": "node dist/cli.js", // optional: start something else than `yarn dev` (times the built bundle)
    "steps": [/* ...see step types below... */],
}
```

## Step types

| Step                                                     | Purpose                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "type": "key", "key": "Enter" }`                      | Send a key. See key reference below.                                                                                                                                                                                                                                                   |
| `{ "type": "type", "text": "hello" }`                    | Type raw text. Also how a **mouse** is sent: SGR reports `\u001b[<button;column;row` + `M` (press / motion) or `m` (release), 1-based, button 0 = left, +32 = motion, +8 = Alt (`examples/select-copy.json` drags over text; the copy is the OSC 52 sequence in the snapshot's `raw`). |
| `{ "type": "wait", "ms": 500 }`                          | Fixed delay.                                                                                                                                                                                                                                                                           |
| `{ "type": "stable" }`                                   | Wait for terminal output to stop for 300ms (app finished rendering). Add `"timeout": 8000` or `"quiescenceMs": 500` to tune.                                                                                                                                                           |
| `{ "type": "waitForContent", "text": "No task" }`        | Block until the given text appears on screen. Add `"timeout": 10000` (ms).                                                                                                                                                                                                             |
| `{ "type": "assert", "contains": "Settings" }`           | Fail immediately if the text is not on screen.                                                                                                                                                                                                                                         |
| `{ "type": "snapshot", "name": "my-state" }`             | Capture terminal state. Accessible in output as `result.snapshots["my-state"].plain` (text) or `.ansi` (with colors).                                                                                                                                                                  |
| `{ "type": "screenshot", "name": "my-shot" }`            | Render a PNG via the built-in terminal emulator. Fast, no external dependency, but fonts and glyphs are approximate.                                                                                                                                                                   |
| `{ "type": "screenshot-powershell", "name": "my-shot" }` | Render a PNG via Windows Terminal — real font, box-drawing, emoji. Saved to `%TEMP%\goblin-tui-test\<name>.png`. Closest to what the user actually sees, but slower (~3–5s). **Preferred for visual validation.**                                                                      |
| `{ "type": "screenshot-browser", "name": "my-shot" }`    | ⚠️ Deprecated. Render a PNG via headless Edge + xterm.js.                                                                                                                                                                                                                              |
| `{ "type": "mark", "label": "idle 8s" }`                 | Starts a new profiling bucket without sending a key, to measure a stretch of `wait` (idle, a synthetic load) on its own.                                                                                                                                                               |
| `{ "type": "startLoad" }` / `{ "type": "stopLoad" }`     | Starts / stops the synthetic activity described by the scenario's `load` (see [Performance suite](#performance-suite)). Needs profiling.                                                                                                                                               |

On a machine without Windows Terminal, `screenshot-powershell` falls back to the built-in emulator (with a warning on stderr) instead of crashing the run.

### Checking text

`assert`, `assertNot`, `waitForContent`, `waitForGone` and `pressUntil` all take **one** of `"contains": "text"` (`"text"` also works) or `"matches": "regular expression"` (flags default to `m`, so `^` / `$` are per line; `"flags": "i"` to change), optionally limited with `"row": 2` (1-based) or `"region": { "row": 1, "col": 1, "width": 40, "height": 3 }`. `assert` also takes `count` (exactly), `min` and `max`. Columns and rows are cells, so a wide emoji does not shift what follows it.

- `{ "type": "assertNot", "contains": "Error" }` — fails if the text **is** on screen.
- `{ "type": "waitForGone", "contains": "Loading", "timeout": 5000 }` — waits for it to disappear.
- `{ "type": "pressUntil", "key": "↓", "contains": "Logs", "max": 30 }` — presses a key until the text shows up (nothing is pressed if it is there already).
- `{ "type": "assertStyle", "contains": "v0.3.0", "dim": true }` — every cell of the first match (`"occurrence": 2` for the next) has the style: `fg` / `bg` (`"default"`, a palette index such as `2`, or `"#rrggbb"`; a palette colour is compared through the standard xterm palette), `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough`.
- `{ "type": "snapshot", "name": "bar", "region": {…} }` — a snapshot of a part of the screen.
- `{ "type": "assertSnapshot", "name": "toolbar", "region": {…}, "mask": ["\\d+ms"] }` — see [Golden snapshots](#golden-snapshots).

### Mouse, paste and resize

A mouse step points at a cell (`"col"`, `"row"`, 1-based) or at a text (`"text"` / `"matches"`, with `"occurrence"` and `"offset"` columns from its left edge; the middle by default), so nothing has to count cells:

- `{ "type": "click", "text": "Settings" }` — also `"button": "right"`, `"double": true`, `"shift"` / `"alt"` / `"ctrl": true`.
- `{ "type": "hover", "text": "Archive" }` — the pointer moves with no button down.
- `{ "type": "drag", "from": { "text": "Hooked" }, "to": { "col": 44, "row": 5 }, "alt": true }` — press, motion on the way, release (`"hold": true` keeps the button down to look at the highlight).
- `{ "type": "wheel", "direction": "down", "count": 3, "col": 30, "row": 10 }`
- `{ "type": "paste", "text": "https://…" }` — one write (`"bracketed": true` wraps it in the bracketed-paste markers; the app does not ask for them today).
- `type` and `paste` wait 100 ms afterwards, like `key` (`"delayMs"` to change it): a key sent at once would reach the app in the same chunk as the text and be read as part of it (an `Enter` that confirms nothing).
- `{ "type": "resize", "cols": 80, "rows": 24 }` — the app is told like it is when the user drags the window's edge.

### The app's state, log and exit

The data folder is the throwaway copy the app runs on (paths are relative to it, and cannot leave it). State checks wait up to `"timeout"` (default 3 s) for the app to get there, since it saves a moment after the change.

- `{ "type": "assertFile", "path": "output/a.flac", "exists": true }` — also `contains`, `matches`.
- `{ "type": "assertJson", "file": "sessions.json", "path": "sessions[0].tasks.length", "gte": 1 }` — a value of a JSON file by path (`a.b`, `a[0]`, `a[-1]`, and `keybindings["sessionsModal.new"]` for a key with dots in it); `equals`, `exists`, `contains`, `matches`, `gt` / `gte` / `lt` / `lte`, `length`.
- `{ "type": "assertLog", "contains": "Imported", "level": "info" }` — lines of `app.log` (`count` / `min` / `max`); `{ "type": "assertNoErrors", "ignore": ["regex"] }` — no `error` line (`"level": "warn"` for warnings too).
- `{ "type": "assertRequest", "url": "api.deezer.com", "min": 1 }` and `{ "type": "network", "rules": […] }` — see [Fake network](#fake-network).
- `{ "type": "exit", "key": "Ctrl+Q", "code": 0 }` — waits for the app to exit by itself (after the optional key) and checks its exit code.

## Key reference

Named keys (use in `"key"` field):

```
Enter  Esc  Tab  Shift+Tab  Space  Del
←  →  ↑  ↓                          (or: ArrowLeft  ArrowRight  ArrowUp  ArrowDown)
Shift+←  Shift+→  Shift+↑  Shift+↓
Ctrl+Shift+↑  Ctrl+Shift+↓          (extend the task selection)
Ctrl+A  Ctrl+C  Ctrl+D  Ctrl+G  Ctrl+N  Ctrl+Q  Ctrl+R  Ctrl+S  Ctrl+T  Ctrl+V  Ctrl+Z
```

Any modifier combination works as well: `Ctrl+←`, `Alt+Enter`, `Ctrl+Shift+F5`, `Ctrl+B`, `Alt+x`, `Shift+Home`, `Ctrl+Delete`; and `F1`–`F12`, `Insert`. A name with a modifier that cannot be read is an error, never typed into the app as text.

Single characters pass through as-is: `"D"`, `"E"`, `"1"`, `"y"`, etc.

## Typical validation pattern

```jsonc
{ "type": "stable", "timeout": 8000 },                   // wait for app boot
{ "type": "waitForContent", "text": "No task" },         // confirm initial state
{ "type": "key", "key": "→" },                           // navigate
{ "type": "stable" },                                    // wait for re-render
{ "type": "assert", "contains": "Settings" },            // verify outcome
{ "type": "snapshot", "name": "after-nav" },             // capture for inspection
{ "type": "screenshot-powershell", "name": "after-nav" } // visual proof
```

## What the examples cover

| Scenario                                  | What it checks                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `actions-menu`                            | The Actions menu: unavailable items listed with their reason, Enter on them does nothing, Esc.   |
| `archive-restore`                         | Del → Archive or Delete; the Archive window, its search, Enter restores with the metadata.       |
| `clipboard-copy-paste`                    | `Ctrl+C` copies full titles; `Ctrl+V` adds a link as a `[USER]` source, kept offline, refetched. |
| `select-copy`                             | Mouse selection: highlight, copy on release, Alt+drag rectangle, never the panel beside it.      |
| `sessions-manage`                         | New, load, rename, duplicate, search and delete sessions, checked in `sessions.json`.            |
| `shortcut-rebind`                         | Rebinding a shortcut: saved, the hint follows it, the old key is free.                           |
| `songlink-consent`                        | A provider that sends data out asks first; "Don't allow" and Esc send nothing.                   |
| `user-data-survives-failed-run`           | A hand-typed title and a pasted link survive a run with the network down.                        |
| `fake-network`, `collection-*`, `group-*` | Reading a link through canned answers; playlists and albums; groups.                             |
| `scroll-*`, `switch-view-column`          | Cursors and scrolling of the task list, the metadata box, the shortcut list; switching views.    |
| `harness-features`                        | A tour of the harness itself (styles, goldens, mouse, resize, log, exit).                        |

## Fixtures

| Fixture                  | Sessions | Tasks | State                                                                                                 |
| ------------------------ | -------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `empty`                  | 0        | 0     | Blank slate — no sessions, no cache. Start here for onboarding flows.                                 |
| `50-tasks`               | 1        | 50    | Tasks are `pending` — Spotify URLs imported but metadata not yet fetched.                             |
| `50-tasks-with-metadata` | 1        | 50    | Tasks are `finished` — Spotify + YouTube metadata fetched, Songlink and MusicBrainz anchors resolved. |
| `collection-failures`    | 1        | 6     | A playlist of five tracks that ended differently: finished, failed (metadata, download), stopped.     |
| `user-data`              | 1        | 2     | Deezer tracks holding a hand-typed title and a hand-pasted link: they must survive any run.           |

`collection-failures` and `user-data` are generated by `fixtures/buildFixtures.ts` (`yarn tsx scripts/tui-test/fixtures/buildFixtures.ts`): when the session format changes, regenerate them.

Set the fixture with `"dataDir"` in the scenario (default: `empty`):

```jsonc
{ "dataDir": "scripts/tui-test/fixtures/50-tasks-with-metadata", "steps": [ ... ] }
```

**A scenario never runs on the fixture itself.** The runner copies it (without `bin/`, logs, locks and `.bak` files) into a fresh temp folder, points `GOBLIN_DATA_DIR` at the copy, sets `music.download.outputDir` and `outputTemporaryDir` to folders inside the copy, and deletes the copy afterwards. So a run cannot modify the tracked fixtures, touch your real data folder or scan `~/Music` (which used to pop up the "temporary downloads are piling up" dialog mid-scenario). Set `GOBLIN_TUI_KEEP_DATA=1` to keep the copy for inspection; its path is printed to stderr.

Most fixtures keep their settings in the old layout (`flows["music-downloader"]`), which the app reads only when there is no `music` section. The copy moves it to `music` before the scenario's `settings` patch is merged, and sets the music folders after the patch, so a patch that adds a `music` key never sends the app back to the real `~/Music` folders (`tests/unit/tuiHarness.test.ts`).

## Clipboard

A scenario never reads nor writes the real clipboard: the harness sets `GOBLIN_TEST_CLIPBOARD` to a file of the data folder, and the app's one clipboard module (`src/base/systemClipboard.ts`) uses it instead of the system's. So a run cannot overwrite what the developer copied, nor depend on it.

- `"clipboard": "text"` in the scenario — on the clipboard when the app starts (empty by default).
- `{ "type": "setClipboard", "text": "https://www.deezer.com/track/3135556" }` — for what the app reads from it: `Ctrl+V` on a platform column ("Paste link"), the import dialog.
- `{ "type": "assertClipboard", "equals": "Hooked" }` — what the app copied last (a mouse selection, `Ctrl+C` on a cell or a source); also `contains`, `matches`, `"empty": true`. Waits up to `"timeout"` (default 3 s).

The copy also goes to the terminal as an OSC 52 sequence, which is in a snapshot's `raw` (`tests/e2e/selection.test.ts` reads it). See `examples/clipboard-copy-paste.json` and `examples/select-copy.json`.

## When a step fails

Before the app starts, the steps are checked (`validateScenario.ts`): an unknown step type or a missing field (a `key` without `key`, an `assert` with no `contains` / `matches`) fails at once instead of after the boot. The unit test that loads every example runs the same check.

The error carries what is needed to understand it without running the scenario again: the step (and its number), the message, the screen, the last inputs sent to the app, the last lines of `app.log` and the last requests of the fake network. `runScenario` throws a `ScenarioFailure` whose `report` holds the same parts.

## Golden snapshots

`assertSnapshot` compares the screen with a text file kept in `scripts/tui-test/golden/<scenario name>/<name>.txt` (the scenario's name is its file name, or `name` in the file). Write or refresh the files with `--update-golden`, read the diff in git, commit it. A mismatch prints a line diff (`-` golden, `+` screen). Use `region` to look only at the part a scenario is about, so an unrelated panel does not break it, and `mask` (regular expressions) for what changes from run to run: a version, a duration. `"timeout"` retries the comparison for a moment, for a screen that is still settling.

## Fake network

A scenario with a `network` section never reaches the internet: the app is started with a preload (`preload/fakeNetwork.mjs`, through `NODE_OPTIONS`) that replaces `fetch`. Each request goes through the rules, the first match wins; one with no rule fails like a missing connection (`"mode": "offline"`, the default) or goes out (`"mode": "passthrough"`).

```jsonc
"network": {
    "rules": [
        { "url": "api.deezer.com/track/3135556", "json": { "id": 3135556, "title": "…" } },
        { "matches": "/search", "status": 429, "times": 2 }, // answers the first two requests only
        { "url": "api.example.com", "delayMs": 3000 }, // a slow answer (cut short by the request's own abort)
        { "url": "api.example.com/x", "error": "socket hang up" } // a broken connection
    ]
}
```

`assertRequest` checks what the app asked for; a `network` step changes the rules while the app runs (`"append": true` adds to the current ones) — a provider that fails halfway, say. See `examples/fake-network.json` and `examples/user-data-survives-failed-run.json`.

`data:`, `blob:` and `file:` URLs (a library loading its WebAssembly) are not the network: they go through untouched and are not logged.

It replaces `fetch` only: a provider that starts a program (yt-dlp, ffmpeg, mpv) or opens its own socket (Soulseek) is not covered, so a download cannot be faked this way.

## Interactive sessions

`sessionCli.ts` keeps one app running between commands, so you press a key, read the screen and decide, instead of writing a whole scenario blind. Every action prints the screen it ends on, with row numbers.

```bash
yarn tsx scripts/tui-test/sessionCli.ts start --data-dir scripts/tui-test/fixtures/50-tasks-with-metadata
yarn tsx scripts/tui-test/sessionCli.ts key Down Down Enter
yarn tsx scripts/tui-test/sessionCli.ts find "Settings"        # row, column and width of the text
yarn tsx scripts/tui-test/sessionCli.ts click "Settings"       # or: click <col> <row>
yarn tsx scripts/tui-test/sessionCli.ts step '{"type":"assertNot","contains":"Error"}'   # any step of the scenario format
yarn tsx scripts/tui-test/sessionCli.ts stop
```

`start` takes `--scenario file.json` (everything but its steps: terminal, `dataDir`, `settings`, `network`, `scale`, `env`), `--data-dir`, `--cols`, `--rows`, `--set a.b=json` (a settings override) and `--name` (to run several at once). A session is a detached process listening on 127.0.0.1 with a random token. It stops with `stop` (`stop --all`), or after 20 minutes without a command. `sessionCli.ts help` lists every command. The server logs to `%TEMP%/goblin-tui-test/sessions/<name>.log`.

## Running them all

`cli.ts --all` runs every scenario of `examples/` and prints one line each, then the failures with their reports; it exits 1 when one failed. It skips `perf-*` / `profile-*` scenarios and those with a custom `command` (`--include-perf`), drops `screenshot*` steps (they open terminal windows; `--screenshots` keeps them) and turns profiling on for a scenario that uses `startLoad`. `--parallel N` (default 2) trades speed for the risk of a `stable` step timing out on a loaded machine. `--filter a,b` keeps the scenarios whose file name contains one of them.

## Render profiling

Screenshots tell you _what_ rendered; profiling tells you _how expensively_. With profiling enabled, the harness boots the app through an instrumented entrypoint that records, on **every React commit**, each component's render time, render count, mount-vs-update, and **why it rendered** (which prop/state changed) — then attributes all of it to the keystroke that caused it.

```bash
# Enable on any scenario without editing it:
yarn tsx scripts/tui-test/cli.ts <scenario.json> --profile --pretty

# Or set it in the scenario file:
#   { "profile": { "enabled": true }, "steps": [ ... ] }
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/profile-navigate.json --pretty
```

The JSON result gains a `profile` field; `--pretty` prints a `profile` section.

### What you get

- **Per-component table** — `renders`, total `self ms`, `p95`, and `wasted` (parent-only re-renders — React.memo candidates), sorted by self time. Ink's own `Box`/`Text` appear here and show the raw redraw volume.
- **Per-interaction breakdown** — for `boot` and each keystroke: commit count, React time, Ink output time (`ink`), app-component wasted renders, and the top components by self time. This is a per-keystroke render budget.
- **Cost axes** — `react` is the cost of running component functions (reconciliation); `ink` is the time of Ink's `Output` stage (React tree → string), captured from Ink's own `onRender`; `layout` is Yoga's layout of each commit and `write` / `KB` the time spent in `stdout.write` and the bytes sent to the terminal. Ink's `renderTime` alone leaves out layout and the write, so the three are recorded separately. A component can be cheap to render but expensive to lay out — all are reported.
- **Anomalies** — see below.

### How it works (so you can trust the numbers)

- `src/profiling/install.ts` installs a `__REACT_DEVTOOLS_GLOBAL_HOOK__` and sets `DEV=true` so Ink wires the reconciler into it. The app is wrapped in one `<Profiler>` to force React's ProfileMode tree-wide, which is what populates per-fiber timing. On each commit the hook walks the fiber tree.
- "Did this component render this commit?" uses React's `PerformedWork` flag (the same signal DevTools uses) — **not** `actualDuration`, which is stale on memoized/bailed-out subtrees. Like DevTools, the walk only descends into a fiber's children when its child list is not the one of the previous tree (`fiber.child !== fiber.alternate.child`): a subtree that was reused untouched keeps the flags of the render that made it and would otherwise be counted again at every commit. A fiber is a mount only inside a subtree created by that commit.
- Records are written as JSONL synchronously per commit, so they survive the harness killing the PTY. The harness buckets them against timestamped keystroke marks.

> Visual output is identical to a normal run, so all `snapshot`/`assert`/`screenshot` steps still work under `--profile`.

### Development vs production build

By default the profiled app runs the **development** build of React (`yarn tsx src/profiling/profiledEntry.tsx`), which is the only one that records per-component times. That build is not what users run: in the shipped bundle React is 2–5 % of a keystroke's CPU and Ink's output stage 75–83 % , so per-component milliseconds rank the wrong things first. For frame, layout, write and byte numbers use the production build:

```json
{ "profile": { "enabled": true, "build": "production" } }
```

It runs the same entry with `NODE_ENV=production`: `ink`, `layout`, `write`, bytes, CPU and event-loop samples stay valid; per-component times are 0 (React's profiler timer is off there; render counts and reasons are still recorded). For the **built bundle itself** (what users run, no hooks at all) use [`bench/latency.ts`](#key-latency).

### Colours

The scenario runner starts the app with `FORCE_COLOR=3` (truecolor, what Windows Terminal, iTerm2 and most Linux terminals give it): 16-colour output would make every frame about 30 % shorter than a user's. A scenario that wants another level sets it in its `env` (`{ "env": { "FORCE_COLOR": "1" } }`).

### Anomalies, thresholds, and baselines

Anomaly rules are **component-agnostic** — they enumerate every component, so a newly-added slow component is caught without naming it anywhere.

| Rule               | Severity  | Meaning                                                                                                                                  |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `commit-cascade`   | **error** | One keystroke caused more commits than `maxCommitsPerInteraction` — an effect loop / runaway `setState`. Machine-independent → fails CI. |
| `slow-interaction` | warn      | One keystroke spent over `maxInteractionReactMs` in React.                                                                               |
| `slow-commit`      | warn      | A single commit exceeded `maxCommitDurationMs`.                                                                                          |
| `slow-component`   | warn      | A component's p95 self render exceeded `maxComponentSelfMsP95`.                                                                          |
| `wasted-renders`   | warn      | An interaction caused more than `maxWastedRendersPerInteraction` app-component parent-only re-renders (Ink primitives excluded).         |

Only `commit-cascade` is an `error` because absolute ms vary by machine (dev `tsx` runs slower than a built binary); ms-based rules are **advisory warnings**. The `render profile` vitest test (`tests/e2e/perf.test.ts`) fails only on `error`-severity anomalies. Override defaults per scenario:

```jsonc
{ "profile": { "enabled": true, "thresholds": { "maxCommitsPerInteraction": 8 } } }
```

**Baselines** catch gradual per-component drift that global thresholds miss. Give the scenario a stable `name` (the CLI defaults it to the filename), then:

```bash
yarn tsx scripts/tui-test/cli.ts <scenario.json> --update-baseline   # write/refresh
yarn tsx scripts/tui-test/cli.ts <scenario.json> --profile           # compare
```

Baselines live in `scripts/tui-test/profiling/baselines/<name>.json`. A regenerated baseline is diffed against the current run: a **render-count** regression is an `error` (machine-independent); a **render-time** regression is a `warn` (with generous tolerance). New components are listed and still covered by the global p95 threshold.

## Large sessions

The tracked fixtures stop at 50 tasks, but most scaling problems only show with hundreds or thousands. A scenario can ask for a size and the runner grows its throwaway copy of the fixture before the app starts (`scaleFixture.ts`), so nothing big is committed:

```jsonc
{
    "dataDir": "scripts/tui-test/fixtures/50-tasks-with-metadata",
    "scale": {
        "tasks": 2000, // tasks in the open session (the fixture's tasks, repeated with fresh ids)
        "otherSessions": 20, // sessions the user is not looking at (still parsed and written on every save)
        "otherSessionTasks": 300, // tasks in each of them (default 100)
        "archived": 300, // archived entries in the open session
    },
}
```

The fixture needs a first session with tasks, such as `50-tasks-with-metadata`.

## Performance suite

Scenarios named `perf-*.json` in `examples/` are the performance scenarios. They measure with profiling on, and use two things the other scenarios do not:

- **Process-level samples.** Every ~250 ms the profiled app records its CPU time and the longest time its event loop was blocked (`cpu` / `block` in the interactions table; `process cpu`, `longest loop block`, `heap max` in the totals). React's profiler cannot see a `JSON.stringify` of a big file or a synchronous `fs` call; these can.
- **Synthetic load** (`src/profiling/loadDriver.ts`, never loaded in production). `startLoad` makes the app change the status of some tasks and write log lines on a fixed tick, through the same APIs the real services use, so the cost of a long run is measured offline and repeatably:

    ```jsonc
    "load": { "tasksPerTick": 40, "tickMs": 250, "logsPerTick": 5, "logLevel": "debug" }
    ```

| Scenario              | What it exercises                                                                  |
| --------------------- | ---------------------------------------------------------------------------------- |
| `perf-idle`           | 8 s of nothing: should be 0 commits.                                               |
| `perf-scale-500/2000` | Boot, navigation, select all and view switch with 500 / 2,000 tasks.               |
| `perf-load-tasks`     | 1,000 tasks, 5 other sessions, 40 tasks changing every 250 ms (a run in progress). |
| `perf-load-logs`      | 50 debug log lines per second (yt-dlp output) with the default `info` level.       |
| `perf-sessions-heavy` | 20 sessions × 300 tasks + archive, tasks changing: the cost of saving a big file.  |
| `perf-modals`         | Opening and scrolling the Sessions and Archive modals with a big store.            |

### Comparing a change with the state before it

```bash
yarn tsx scripts/tui-test/perfSuite.ts --label before     # 3 runs per scenario (--runs N), medians, + micro-benchmarks
# ...make the change...
yarn tsx scripts/tui-test/perfSuite.ts --label after
yarn tsx scripts/tui-test/perfCompare.ts before after
```

Results go to `profiling/results/<label>.json` (git-ignored). **Counts** (commits, Ink frames, renders per component) are reliable from run to run and from machine to machine; **milliseconds** only compare runs made on the same machine, back to back, and are development-build numbers. `--only a,b`, `--no-bench` and `--no-scenarios` narrow a run. Run nothing else heavy while it measures; a full run takes about 20 minutes.

To measure from a state you are about to change, copy the tree first (without `node_modules`, with a junction to it) and run the suite there, so you can keep editing.

### Key latency

`bench/latency.ts` drives the **built bundle** (`yarn build`, then `node dist/cli.js`) through a PTY and reports what a user feels: per key, the time to the first byte and until the screen has settled, and the bytes the terminal had to parse; for a held key, how long the screen keeps moving after release. `perfSuite.ts` runs four configurations of it (`↓` at 128×50 and 200×60, `Ctrl+A`/`Esc`, view switch `2`/`1`, all with 2,000 tasks) and `perfCompare.ts` prints them as "key latency"; `--no-latency` skips them. Options and the reasoning are in the header of the file. Use `--interval 400` or more for `↓`: the second frame of a trailing debounce lands 130–270 ms after the key.

The machine-independent part is checked in CI: `tests/e2e/perf.test.ts` asserts that an isolated `↓` sends one frame of bytes, not two.

### Micro-benchmarks

`bench/microBench.ts` times the paths no screen scenario isolates (saving and loading a 14 MB `sessions.json`, listing a 3,000-file temp folder, the log ring) through the modules' public API, so it measures the code before and after a fix. `yarn tsx scripts/tui-test/bench/microBench.ts` prints a table; `--json` is what the suite stores.

### Finding a cascade: the commit timeline

The tables say how much; `profiling/timeline.ts` says what, commit by commit, with the reason each component rendered:

```bash
yarn tsx scripts/tui-test/profiling/timeline.ts "$TEMP/goblin-tui-test/profile-<id>.jsonl" --from 9000 --to 10500
```

Every profiled run leaves its raw `profile-<id>.jsonl` in the OS temp folder (`goblin-tui-test/`).
