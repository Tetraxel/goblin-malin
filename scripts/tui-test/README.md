# TUI Test Harness

Headless scenario runner for validating user flows and visual appearance without running the app manually.

## Running a scenario

```bash
# Machine-readable output (JSON with snapshots + metrics)
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json

# Human-readable: live event stream + inline ANSI snapshots
yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/navigate-settings.json --pretty
```

`--pretty` is best for interactive debugging. Plain JSON is best for automated validation — parse `result.snapshots["name"].plain` to assert on screen content.

## Scenario file format

Scenarios are JSON files in `scripts/tui-test/examples/`.

```jsonc
{
    "terminal": { "cols": 128, "rows": 64 }, // optional, defaults: 200×50
    "dataDir": "scripts/tui-test/fixtures/empty", // optional: sets GOBLIN_DATA_DIR
    "steps": [ /* ...see step types below... */ ]
}
```

## Step types

| Step | Purpose |
|------|---------|
| `{ "type": "key", "key": "Enter" }` | Send a key. See key reference below. |
| `{ "type": "type", "text": "hello" }` | Type raw text. |
| `{ "type": "wait", "ms": 500 }` | Fixed delay. |
| `{ "type": "stable" }` | Wait for terminal output to stop for 300ms (app finished rendering). Add `"timeout": 8000` or `"quiescenceMs": 500` to tune. |
| `{ "type": "waitForContent", "text": "No task" }` | Block until the given text appears on screen. Add `"timeout": 10000` (ms). |
| `{ "type": "assert", "contains": "Settings" }` | Fail immediately if the text is not on screen. |
| `{ "type": "snapshot", "name": "my-state" }` | Capture terminal state. Accessible in output as `result.snapshots["my-state"].plain` (text) or `.ansi` (with colors). |
| `{ "type": "screenshot", "name": "my-shot" }` | Render a PNG via the built-in terminal emulator. Fast, no external dependency, but fonts and glyphs are approximate. |
| `{ "type": "screenshot-powershell", "name": "my-shot" }` | Render a PNG via Windows Terminal — real font, box-drawing, emoji. Saved to `%TEMP%\goblin-tui-test\<name>.png`. Closest to what the user actually sees, but slower (~3–5s). **Preferred for visual validation.** |
| `{ "type": "screenshot-browser", "name": "my-shot" }` | ⚠️ Deprecated. Render a PNG via headless Edge + xterm.js. |

## Key reference

Named keys (use in `"key"` field):

```
Enter  Esc  Tab  Shift+Tab  Space  Del
←  →  ↑  ↓                          (or: ArrowLeft  ArrowRight  ArrowUp  ArrowDown)
Shift+←  Shift+→  Shift+↑  Shift+↓
Ctrl+A  Ctrl+C  Ctrl+D  Ctrl+N  Ctrl+R  Ctrl+S  Ctrl+V
```

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

## Fixtures

| Fixture | Sessions | Tasks | State |
|---|---|---|---|
| `empty` | 0 | 0 | Blank slate — no sessions, no cache. Start here for onboarding flows. |
| `50-tasks` | 1 | 50 | Tasks are `pending` — Spotify URLs imported but metadata not yet fetched. |
| `50-tasks-with-metadata` | 1 | 50 | Tasks are `finished` — Spotify + YouTube metadata fetched, Songlink and MusicBrainz anchors resolved. |

Set the fixture with `"dataDir"` in the scenario:

```jsonc
{ "dataDir": "scripts/tui-test/fixtures/50-tasks-with-metadata", "steps": [ ... ] }
```

## Render profiling

Screenshots tell you *what* rendered; profiling tells you *how expensively*. With profiling enabled, the harness boots the app through an instrumented entrypoint that records, on **every React commit**, each component's render time, render count, mount-vs-update, and **why it rendered** (which prop/state changed) — then attributes all of it to the keystroke that caused it.

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
- **Two cost axes** — `react` is the cost of running component functions (reconciliation); `ink` is Ink's output cost (Yoga layout + ANSI diff + write), captured from Ink's own `onRender`. A component can be cheap to render but expensive to lay out — both are reported.
- **Anomalies** — see below.

### How it works (so you can trust the numbers)

- `src/profiling/install.ts` installs a `__REACT_DEVTOOLS_GLOBAL_HOOK__` and sets `DEV=true` so Ink wires the reconciler into it. The app is wrapped in one `<Profiler>` to force React's ProfileMode tree-wide, which is what populates per-fiber timing. On each commit the hook walks the fiber tree.
- "Did this component render this commit?" uses React's `PerformedWork` flag (the same signal DevTools uses) — **not** `actualDuration`, which is stale on memoized/bailed-out subtrees.
- Records are written as JSONL synchronously per commit, so they survive the harness killing the PTY. The harness buckets them against timestamped keystroke marks.

> Visual output is identical to a normal run, so all `snapshot`/`assert`/`screenshot` steps still work under `--profile`.

### Anomalies, thresholds, and baselines

Anomaly rules are **component-agnostic** — they enumerate every component, so a newly-added slow component is caught without naming it anywhere.

| Rule | Severity | Meaning |
|---|---|---|
| `commit-cascade` | **error** | One keystroke caused more commits than `maxCommitsPerInteraction` — an effect loop / runaway `setState`. Machine-independent → fails CI. |
| `slow-interaction` | warn | One keystroke spent over `maxInteractionReactMs` in React. |
| `slow-commit` | warn | A single commit exceeded `maxCommitDurationMs`. |
| `slow-component` | warn | A component's p95 self render exceeded `maxComponentSelfMsP95`. |
| `wasted-renders` | warn | An interaction caused more than `maxWastedRendersPerInteraction` app-component parent-only re-renders (Ink primitives excluded). |

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
