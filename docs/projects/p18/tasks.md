# P18 — Component Render Profiling

## Goal

[P17](../p17/tasks.md) gave the harness screenshots and clean text snapshots — it can verify _what_ the app renders, but not _how expensively_. That is a blind spot for performance: features get added, render cost creeps up, and nobody notices on fast hardware until the TUI feels sluggish. Screenshot-to-screenshot wall-clock timing is far too coarse and noisy to catch this — it smears React work, Yoga layout, ANSI diff, PTY latency and a 16 ms render throttle into one number.

This project adds **per-component render profiling** to the harness: on every React commit, record each component's render time, render count, mount-vs-update, and the prop/state change that caused it — attributed to the keystroke that triggered it. It then flags **anomalies** against component-agnostic thresholds (so newly-added components are covered automatically) and supports per-scenario **baselines** for catching gradual drift.

### The two cost axes

Ink is React on a custom reconciler that paints to a terminal. Performance has two distinct axes, and most "React profilers" only see the first:

1. **React render cost** — running component functions (reconciliation). Measured per component.
2. **Ink output cost** — Yoga `calculateLayout` + ANSI diff + `stdout` write. Measured per frame.

A component can be cheap to render but expensive to lay out. Both are captured.

### Design decisions

- **Devtools-hook fiber walk, not per-component wrappers.** A `__REACT_DEVTOOLS_GLOBAL_HOOK__` is installed before Ink loads; on each commit we walk the fiber tree and read per-fiber timing. This is exhaustive and automatic — every component, including ones added later, with zero per-component instrumentation.
- **`DEV=true` to wire the hook.** Ink only calls `reconciler.injectIntoDevTools()` when `DEV==='true'` (see `node_modules/ink/build/ink.js`). It does **not** require `react-devtools-core` (absent here), so no socket connection is attempted.
- **One `<Profiler>` to force ProfileMode.** Ink injects devtools _after_ creating the root, so the root isn't in ProfileMode and per-fiber `actualDuration` would never be recorded. Wrapping the app in a single `<Profiler>` forces ProfileMode tree-wide, which is what populates the timing. The `<Profiler>` callback itself is a no-op; per-component data comes from the hook walk.
- **`PerformedWork` flag for "did it render", not `actualDuration`.** `actualDuration` is stale on bailed-out (memoized) subtrees, so it cannot tell you whether a component re-rendered. The `PerformedWork` fiber flag (`flags & 1`) is React's real signal — the same one DevTools uses.
- **Axis E from Ink's own `onRender` option.** `render()` forwards arbitrary options to the Ink instance, and Ink already measures and exposes per-frame output time via `onRender({ renderTime })`. No monkeypatching of Ink internals.
- **Synchronous JSONL, bucketed by interaction marks.** The profiler appends one record per commit synchronously (`fs.writeSync`) so data survives the harness hard-killing the PTY. The runner timestamps each keystroke; the analyzer buckets commits into per-interaction slices by timestamp (shared wall clock, same machine).
- **Counts hard-fail, ms advises.** Dev-mode (`tsx`) timings run higher than a built binary and vary by machine. So the only `error`-severity anomaly is `commit-cascade` (commits per interaction — machine-independent); ms-based rules emit `warn`. The CI test fails only on `error`.
- **In-process code under `src/`, analysis under `scripts/`.** The instrumentation needs JSX and `#` aliases (main tsconfig); the analyzer is pure dev tooling (harness tsconfig). They share only the JSONL record contract.

---

## Tasks

### T18.1 — In-process instrumentation

**Files:** `src/profiling/{types,recorder,install}.ts`, `src/profiling/profiledEntry.tsx`

`install.ts` sets `DEV=true`, installs the global devtools hook, and on each `onCommitFiberRoot` walks the fiber tree: resolves component names (function/class/memo/forwardRef), detects renders via `PerformedWork`, computes self time (`actualDuration − Σ children`), classifies mount/update, and diffs `memoizedProps`/hook state for the "why". `recorder.ts` is the durable JSONL writer. `profiledEntry.tsx` imports `install` (side effect) then boots the app.

| Status |
| --------- |
| ✅ Done |

### T18.2 — App wiring

**File:** `src/index.tsx`

When `globalThis.__GOBLIN_PROFILE__` is set, wrap the app in one `<Profiler>` and pass Ink's `onRender` for axis-E frame timing. Production (global unset) is untouched.

| Status |
| --------- |
| ✅ Done |

### T18.3 — Harness analysis

**Files:** `scripts/tui-test/profiling/{types,thresholds,analyze,baseline,format}.ts`

Read the JSONL, bucket by interaction marks, aggregate per-component stats (renders, self total/max/p95, wasted), per-interaction stats (commits, React ms, Ink ms, app-wasted, top components), detect anomalies, and compare/update baselines. `format.ts` renders the `--pretty` section.

| Status |
| --------- |
| ✅ Done |

### T18.4 — Harness integration

**Files:** `scripts/tui-test/{runner,cli,types}.ts`

Profile mode spawns `profiledEntry.tsx` with `DEV=true` + `GOBLIN_PROFILE_OUT`, records timestamped interaction marks per `key`/`type` step, and runs the analyzer after teardown into `HarnessResult.profile`. CLI gains `--profile` and `--update-baseline`; scenarios gain `name` and `profile`.

| Status |
| --------- |
| ✅ Done |

### T18.5 — Example scenario + regression test

**Files:** `scripts/tui-test/examples/profile-navigate.json`, `tests/e2e/perf.test.ts`

A worked profiling scenario and a vitest test that fails only on `error`-severity anomalies (baseline-independent — no `name` set).

| Status |
| --------- |
| ✅ Done |

### T18.6 — Docs

**Files:** `scripts/tui-test/README.md`, `CLAUDE.md`, `docs/projects/README.md`, this file

| Status |
| --------- |
| ✅ Done |

---

## Verification

| Check | Action |
|---|---|
| Types | `yarn type-check` and `yarn type-check:tui` clean |
| Lint | `yarn lint` — profiling files add no warnings |
| End-to-end | `yarn tsx scripts/tui-test/cli.ts scripts/tui-test/examples/profile-navigate.json --pretty` prints a profile section with per-component table, per-interaction breakdown, and anomalies |
| Hook fires | All commits report `durationMs > 0` (ProfileMode active via the `<Profiler>`) |
| Attribution | Commits bucket into `boot` + one slice per keystroke |
| Anomalies | No `error`-severity anomalies on the clean app; ms `warn`s surface (e.g. Toolbar BigText) |
| CI | `yarn test` — `render profile` test green |
| Baseline | `--update-baseline` writes `profiling/baselines/<name>.json`; a re-run compares against it |

## Limitations / future work

- Timings are dev-mode (`tsx`) and machine-relative; lead with counts and relative deltas for hard gates. A built-binary profiling entry would tighten absolute ms.
- Axis E is captured at frame granularity (Ink's `onRender` = output + diff, not Yoga `calculateLayout` in isolation). Wrapping `calculateLayout` would separate layout from diff.
- "Why did it render" covers props and function-component hook state; class state and context-dependency changes fall back to `parent`.
- Render-storm detection is per-component-name aggregate, not per-instance (fibers lack stable keys here); `commit-cascade` is the instance-independent backstop.
