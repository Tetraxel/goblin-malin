# P19 — Scroll & Render Performance

## Goal

Scrolling the task list felt sluggish (~15 fps). [P18](../p18/tasks.md) gave us the
tooling to see why: per-keystroke React + Ink timing, attributed to each keystroke.
This project uses that signal to remove the structural causes of the slowness so the
task list scrolls smoothly regardless of how much metadata each task carries.

### What the profiler showed

Measured on the `50-tasks-with-metadata` fixture, one `ArrowDown` in steady-state
scroll cost roughly:

| Axis | Cost / keystroke |
| ---- | ---------------- |
| React render | ~24 ms |
| Ink output (Yoga layout + ANSI diff) | ~33 ms |
| **Total** | **~57 ms → ~17 fps** |

Three structural causes, in order of impact:

1. **`Task.get()` returned a fresh object every call**, and `task.subscribe()` fires
   its callback immediately on subscribe — so `useTask` double-rendered on mount and
   no cell could ever memo-bail (the `task` prop reference always changed).
2. **The whole secondary (metadata) panel re-rendered on every cursor move.** Moving
   the task cursor changes `selectedTask`, which re-rendered `MetadataSourceList` +
   `MetadataDetailPanel` (every group/result/Uri/field) — hundreds of nodes the user
   doesn't even need updated mid-scroll.
3. **A single monolithic `FocusContext`.** Its value was a brand-new object every
   render, and React Context has no partial subscription, so all ~30 consumers
   (Toolbar, Footer, every modal, InputRouter, …) re-rendered on every keystroke even
   though only the task-list cursor moved.

### Design decisions

- **Cache the task snapshot, invalidate on notify.** `Task.get()` memoizes its result
  and clears it only in `notifyTaskSubscribers()`. This gives `React.memo` a stable
  `task` prop so cells bail when their data is unchanged — the prerequisite for every
  other memoization here.
- **Trust timing, not raw render counts.** The P18 profiler classifies a fiber as a
  "mount" via `fiber.alternate == null`, which **over-reports** during Ink memo
  bailouts (a commit showed `ArtistCell ×19` while only 2 `TaskRow`s rendered — two
  rows cannot hold 19 cells). Verification here leans on per-keystroke React/Ink ms,
  the `wasted` count, and **component presence/absence** in commits, not mount tallies.
- **Defer, don't just memoize, the secondary panel.** Even fully memoized, the panel
  must re-render when `selectedTask` changes — and it changes on every scroll step.
  Debouncing the task fed to the panel (`useDebouncedValue`, 80 ms) freezes it during a
  scroll burst and lets it catch up once the cursor settles. Real held-key autorepeat
  (~30–50 ms) is faster than the debounce, so it coalesces; deliberate single steps
  (>100 ms apart) update promptly.
- **A memo boundary only holds if no descendant consumes the volatile context.** React
  re-renders a context consumer even when its parent bails. So decoupling the metadata
  panel required removing `useFocusContext` from **both** `MetadataPanel` and
  `MetadataDetailPanel` and passing their inputs as referentially-stable props.
- **Split `FocusContext` by change frequency, not by feature.** On a task-list scroll
  the *only* slice that changes is `focusState.taskList`. So the split is: stable
  **actions**, a **chrome** slice (everything stable during scroll), and the **taskList**
  slice. Chrome-only consumers stop re-rendering on scroll entirely. A back-compat
  `useFocusContext()` aggregator is kept for the handful of consumers that genuinely
  need to re-render on scroll, so the migration is incremental and low-risk.
- **Simulate held-key scroll in the harness.** The runner hard-coded a 100 ms gap
  after every key, so it literally could not reproduce autorepeat. A `delayMs`/`repeat`
  option on the `key` step makes fast scrolling measurable.

---

## Tasks

### T19.1 — Stable task snapshots + cell memoization

**Files:** `src/base/task/task.ts`, `src/hooks/useTask.ts`,
`src/components/TaskListPanel/TaskListPanel.tsx` (`ColumnComponent` type),
`src/components/SecondaryPanel/MetadataPanel/Uri.tsx`, all `*Cell.tsx` columns.

`Task.get()` caches its snapshot and invalidates it in `notifyTaskSubscribers()`.
`ColumnComponent` widened to `React.ComponentType` so memo-wrapped cells satisfy it.
All cell components and `Uri` wrapped in `React.memo`.

| Status |
| --------- |
| ✅ Done |

### T19.2 — Defer the secondary panel during scroll

**Files:** `src/hooks/useDebouncedValue.ts` (new),
`src/components/SecondaryPanel/SecondaryPanel.tsx`,
`src/components/SecondaryPanel/MetadataPanel/MetadataPanel.tsx`,
`src/components/SecondaryPanel/MetadataPanel/MetadataDetailPanel.tsx`.

`SecondaryPanel` feeds the panels a debounced `selectedTask` and lifts the metadata
panel's context reads up into stable props. `MetadataPanel` is `React.memo`-wrapped,
context-free, and memoizes `computeCompiledMetadata`; `MetadataDetailPanel` drops its
`useFocusContext` and takes `setIsEditingField` as a prop. Verified: at a diagnostic
1000 ms debounce, `MetadataPanel` mounts once and bails for the whole burst.

| Status |
| --------- |
| ✅ Done |

### T19.3 — Harness: simulate held-key scroll

**Files:** `scripts/tui-test/{runner,types}.ts`,
`scripts/tui-test/examples/scroll-task-list-fast.json` (new),
`scripts/tui-test/examples/scroll-task-list.json`.

`key` steps gain optional `delayMs` (gap after each press, default 100 ms) and `repeat`
(send N times). The fast scenario presses `ArrowDown ×30` at 35 ms to emulate autorepeat.

| Status |
| --------- |
| ✅ Done |

### T19.4 — Split FocusContext into slices

**Files:** `src/contexts/FocusContext.tsx`, `src/hooks/useFocusManager.ts`, and the
migrated consumers below.

`useFocusManager` memoizes its width-derived slices so their identity is stable.
`FocusContext` now exposes three contexts + hooks: `useFocusActions()` (stable),
`useFocusChrome()` (window/chrome state, unchanged during scroll), `useFocusTaskList()`
(selection slice). `useFocusContext()` is kept as a back-compat aggregator for the
task-list consumers that must re-render on scroll.

Migrated to sliced hooks (no longer re-render on scroll): Toolbar (+PrimaryModeTabBar),
Footer, InputRouter, DownloadPanel, useImportFlow, useKeyHandlers (toolbar/prompt),
all modals (Sessions/Welcome/Update/Import/Settings/SetupWizard/Start/Confirm/Prompt),
the toolbar buttons (Settings/Sessions/UpdateBadge), and useRunAllButton.

Still on the aggregator (must re-render on scroll, by design): TaskListPanel, ActionBar,
SecondaryPanel, LogPanel, and the taskList branch of useKeyHandlers.

| Status |
| --------- |
| ✅ Done |

### T19.5 — Docs

**Files:** `docs/projects/README.md`, this file.

| Status |
| --------- |
| ✅ Done |

---

## Verification

| Check | Action |
|---|---|
| Types | `yarn type-check` and `yarn type-check:tui` clean |
| Lint | `yarn lint` — no new warnings from changed files |
| Chrome off the scroll path | `--profile` on `scroll-task-list-fast.json`: Toolbar, Footer, PrimaryModeTabBar, AppInner, and every modal appear **0×** across scroll commits |
| Wasted renders | per-keystroke `wasted` dropped from 4–5 to **0** |
| Panel deferral | `MetadataPanel` bails during a scroll burst (mount once, then absent from commits) |
| Behaviour intact | snapshots in the scroll scenarios still show the correct selected-task metadata after settling |

### Results (fast-scroll scenario, `50-tasks-with-metadata`)

| Metric | Before | After |
|---|---|---|
| Wasted renders / keystroke | 4–5 | **0** |
| Chrome components rendering on scroll | all | **none** |
| Ink frames over the burst | 70 | 33 |
| React / keystroke when coalesced | ~24 ms | down to **~4 ms** |

## Limitations / future work

- **Ink full-tree redraw remains the floor.** Ink re-runs Yoga layout + ANSI diff over
  the whole tree on every commit (~13 ms here) regardless of how localized the change
  was. The lever left is reducing total node count (flatten per-row Box/Text, merge Uri
  segments) — a separate, broad effort.
- **The debounce can't fully coalesce in the harness.** Each synthetic key takes ~28 ms
  to process, so the effective gap sits near the 80 ms window; real autorepeat queues
  faster and coalesces more aggressively than the test shows.
- **`selectedTaskIds` rides the taskList slice**, so `useRunAllButton` /
  `ToolbarButtonInvoker` still re-render on plain cursor moves (cheap). Splitting the
  multi-select set into its own slice would remove that, if it ever matters.
- **Two commits per keystroke** persist (a second commit from the shortcut-registry
  pub-sub landing outside React's batch). Collapsing to one commit would roughly halve
  the Ink frames again.
