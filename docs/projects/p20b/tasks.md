# P20b — Remove the Flow Abstraction: Tasks

## Context

The "flow" concept (`FlowBase` + `FlowOrchestrator`'s flow registry + `MusicDownloadFlow`) was built for a future with multiple flows (video downloads, a showcaller-style sound/light trigger app). That future never arrived inside this codebase, and the abstraction now costs more than it returns. This project removes the concept — **keeping the parts that are genuinely generic** (the task engine, the service registries, dynamic column/action lists) and deleting the class-shaped indirection around them.

### The receipts — what the abstraction costs today

**Dead weight:**

- [flow-base.ts](../../../src/base/flow/flow-base.ts): 137 lines; more than half its methods are `throw Error("Not implemented")` placeholders that exist only so one subclass can override them.
- [FlowSelector.tsx](../../../src/components/Toolbar/FlowSelector.tsx) is dead — its only call-site is commented out in `Toolbar.tsx`. `useImportButton.ts` is dead (never referenced).
- `FlowOrchestrator.registerFlow/getFlow/getAllFlows/getEnabledFlows` + the `FlowClass` interface serve a registry of exactly one entry.

**The "weird useEffect/state" tax** (the actual pain this project removes):

- [App.tsx](../../../src/components/App.tsx): `activeFlowId` is a `useState` **that can never change** (initialized to the only flow; the only setter path is the dead FlowSelector) — and flow registration happens as a *side effect inside the useState initializer*. `filteredTasks` re-filters by `task.getFlowId() === activeFlowId` on every task change — always a no-op copy.
- App.tsx's flow-subscription effect mirrors `getToolbarButtons()`/`getColumns()` into React state, with a hand-rolled structural-equality check to avoid breaking `React.memo` — class pub-sub re-imported into React through the back door.
- **Display mode lives in two stores at once**: `MusicDownloadFlow.displayMode` (class field, notifies flow subscribers → App recomputes columns) *and* `FocusContext.primaryMode` (drives SecondaryPanel). Every `1`/`2` keypress writes both: `switchMode(flow, "1"); setPrimaryMode("metadata")` ([InputRouter.tsx](../../../src/components/InputRouter.tsx)).
- Defensive optional-member dances everywhere the "generic" flow is consumed: `currentFlow?.getFlowSettings?.()` / `currentFlow?.buildFlowSettingsItems?.(…)` ([SettingsModal.tsx](../../../src/components/SettingsModal/SettingsModal.tsx)), `typeof flow.switchMode !== "function"` ([useFocusManager.ts](../../../src/hooks/useFocusManager.ts)), `if (flow.createTasksFromSnapshots)` ([sessionManager.ts](../../../src/sessions/sessionManager.ts)), `flow: FlowBase | undefined` props forcing `currentFlow && …` guards through [AppInner.tsx](../../../src/components/AppInner.tsx).
- The abstraction already leaks its single-flow reality: `sessionManager.ts:120` hardcodes `flowId: "music-downloader"`; `useRunAllButton` filters `t.getFlowId() === flow.id` — always true; `Task.flowId` is threaded through every constructor to feed those no-op checks.

### What stays (the real extensibility axes)

| Keep | Why |
| ---- | --- |
| `FlowOrchestrator`'s task engine (pump, concurrency, abort, subscribe) | Post-P20 it's an excellent, flow-agnostic scheduler. Only its flow-registry surface goes. |
| `Task` / `TaskStatus` / `TaskSnapshot` | The orchestrator's unit of work — generic and load-bearing (sessions, P25). Only `flowId` goes. |
| The three **service registries** + provider registration | This is the product's actual extensibility axis (CLAUDE.md philosophy) — untouched. |
| **Dynamic** columns / contextual actions / toolbar buttons | Stay dynamic (registry-driven lists), but become plain module functions instead of class methods reached through subscriptions. |

If a second "flow" ever really materializes, nothing here forecloses it: the engine, Task, and registry patterns remain generic, and the right shape can be chosen then (separate entry point, top-level mode, or reintroducing a seam) with real requirements instead of speculative ones.

---

## Tasks

### T20b.1 — One source of truth for display mode

- Delete `displayMode` / `getDisplayMode()` / `setDisplayMode()` / `switchMode()` from the flow. `FocusContext.primaryMode` becomes the only mode state.
- `InputRouter` handlers for `1`/`2` call only `setPrimaryMode(...)`; delete `useFocusManager.switchMode` (and its `typeof` guard).
- Column computation becomes a function of the mode: `computeColumns(mode, …)` (T20b.3) — callers pass `primaryMode` down instead of the flow reading its own field.
- Anything else reading `flow.getDisplayMode()` (SecondaryPanel already uses `primaryMode`) switches to the context value.

_Depends on: nothing_

---

### T20b.2 — Columns & toolbar buttons as pure derivations

Replace App.tsx's flow-subscription → `setState` mirroring:

- `const TOOLBAR_BUTTONS = [useRunAllButton, useSessionsButton, useSettingsButton, useExitButton]` — a module constant (the flow's contribution was always exactly `[useRunAllButton]`). No state, no effect.
- `const columns = useMemo(() => computeColumns(primaryMode), [primaryMode, settingsVersion])` — with a small new `useSettingsVersion()` hook (subscribe to `SettingsStore.onSettingsChanged`, bump a counter). This replaces the flow pub-sub channel *and* the structural-equality workaround: memoization now comes from honest `useMemo` inputs. Column-ratio saves (`setColumnRatios`) already go through the settings store, so they retrigger the memo naturally.
- Delete `FlowBase.subscribe`/`notifyTaskSubscribers` and App's `toolbarButtons`/`columns` state + effect.

_Depends on: T20b.1, T20b.3 (the `computeColumns` module)_

---

### T20b.3 — De-class `MusicDownloadFlow` into plain modules

Split the 689-line god class ([musicDownloadFlow.ts](../../../src/flows/musicDownloadFlow/musicDownloadFlow.ts)) by responsibility — same folder, no behavior change:

| New module | Contents (moved, not rewritten) |
| ---------- | ------------------------------- |
| `registries.ts` | The three `ServiceRegistry` instances as module singletons + all `.register(…)` calls. **Adding a provider stays a one-line change here.** |
| `taskFactory.ts` | `createTasksFromUrls`, `createTasksFromSnapshots`, and the dedup logic currently in `FlowBase.importTasks` (the one real method the base class had). |
| `runController.ts` | `runAll`, `runSelected`, `stopAll`, `restartTask` — thin functions over the orchestrator. |
| `columns.tsx` | `getColumns()` → `computeColumns(mode)` (pure: mode + settings in, `ColumnDefinition[]` out) + `saveColumnRatios()`. |
| `contextualActions.ts` | `getContextualActionBar` → `buildContextualActionBar(task, ctx)` + the two private builder helpers. |
| `settings.ts` | Flow-settings accessors as plain functions over `SettingsStore` with a module constant key; delete the `FlowSettings` wrapper class ([flow-settings.ts](../../../src/base/flow/flow-settings.ts)). |
| `init.ts` | `initMusicApp(orchestrator)`: provider registration + `applyConcurrencySettings` + the settings-change subscription. Called **once, explicitly, from the entry point** (`cli.ts`/`index.tsx`) — replacing the side-effectful `useState` initializer in App.tsx. |

Singleton state the class carried (`instance`, `tasks` mirror, `maxConcurrentTasks` — declared but ignored since P20) is deleted; the orchestrator already owns the task list.

_Depends on: T20b.1_

---

### T20b.4 — Slim the orchestrator to a task engine

- Delete from [flow-orchestrator.ts](../../../src/base/flow/flow-orchestrator.ts): `flows` set, `registerFlow`, `getFlow`, `getAllFlows`, `getEnabledFlows`, `FlowClass`. Everything else (pump, add/remove/set tasks, abort, subscribe) is untouched.
- Rename `FlowOrchestrator` → `TaskOrchestrator`, move to `src/base/task/orchestrator.ts` next to `task.ts` (mechanical; `id: "flow-orchestrator"` → `"task-orchestrator"`).
- Delete `flow-base.ts`.

_Depends on: T20b.2, T20b.3 (last consumers of the flow surface)_

---

### T20b.5 — Un-thread the flow from the component tree

- Delete props `currentFlow` / `flow` / `flows` / `onFlowChange` / `setActiveFlowId` from `AppInner`, `Toolbar`, `ToolbarButtonInvoker` (+ the `ToolbarButtonHook<TFlow>` type param), `TaskListPanel`, `TaskRow`, `ActionBar`, `SecondaryPanel`, `InputRouter`; consumers import the T20b.3 modules directly (`buildContextualActionBar` in `ActionBar`/`useTaskListShortcuts`, `saveColumnRatios` in `TaskListPanel`, `taskFactory` in `useImportFlow`).
- `SettingsModal`: the `currentFlow?.getFlowSettings?.()` optional-chaining dance becomes direct imports from `settings.ts`/`buildFlowSettingsItems` — no optionality left to defend against.
- `sessionManager.init(flow, orchestrator)` → `init(orchestrator)`, calling `taskFactory.createTasksFromSnapshots` directly (drop the `if (flow.createTasksFromSnapshots)` guard and the hardcoded `flowId` literal); same for `loadSession`/`duplicateSession` and `SessionsModal`.
- Delete `FlowSelector.tsx` and `useImportButton.ts` (dead), App's `activeFlowId`/`currentFlow`/`filteredTasks` (components receive `tasks` directly).

_Depends on: T20b.3, T20b.4_

---

### T20b.6 — `Task.flowId` & stored-data cleanup

- Remove `flowId`/`getFlowId()` from `Task` and every constructor call; delete the always-true `getFlowId() === flow.id` filters (`useRunAllButton`, App, `runSelected`'s guard).
- [env.ts](../../../src/base/env.ts): `patchFlowSettings(this.task.getFlowId(), …)` → the `settings.ts` module key.
- `settings.json` compat: keep `SettingsStore`'s storage section but read/write it under a fixed key; one-time silent migration on load (`flows["music-downloader"]` → `music`), so existing users lose nothing.
- `sessions.json` compat: `StoredSession.flowId` becomes optional — ignored on read, no longer written. (Early-dev data-model caveat in the README covers older readers.)

_Depends on: T20b.5_

---

### T20b.7 — Housekeeping (optional, recommended)

- Move `startOptionsBridge.ts` / `deleteConfirmBridge.ts` out of `src/base/flow/` (they're generic plain-TS→modal bridges, nothing flow-specific) to `src/base/bridges/`; then delete the empty `src/base/flow/` directory.
- **Optional folder rename**: `src/flows/musicDownloadFlow/` → `src/music/` with a `#music/*` alias. Mechanical, but note: the P21–P28 plan docs reference current paths — if renamed, sweep `docs/projects/` in the same commit (grep `src/flows/musicDownloadFlow`). Skipping the rename is fine; removing the class is the substance, the folder name is cosmetics.

_Depends on: T20b.4, T20b.5_

---

### T20b.8 — Verification & regression gate

- After **each** task (they're independently landable in order): `yarn type-check`, `yarn lint`, `yarn test` (unit + e2e smoke + render-profile budgets), and the tui-test scenarios — the harness boots through the real entry point, so it exercises the new `initMusicApp` bootstrap for free.
- Behavior checklist (manual or scenario-backed): import, run all / run selected, mode switch `1`/`2`, column resize persists, contextual actions per column, settings save (flow section), session save/reopen/duplicate, restart-without-cache.
- Final grep gate — zero hits in `src/` for: `FlowBase`, `FlowClass`, `registerFlow`, `getAllFlows`, `getEnabledFlows`, `getFlowId`, `activeFlowId`, `currentFlow`, `FlowSelector`, `switchMode`.
- Expected net effect: **~400+ lines deleted** (flow-base, registry surface, selector, dead button, mirroring effects, no-op filters), two state channels collapsed into one (mode), one fewer pub-sub system, zero optional-member guards on the main render path.

_Depends on: T20b.1–T20b.7_

---

## Summary

| Task  | What                                                             | Depends on    |
| ----- | ----------------------------------------------------------------- | ------------- |
| T20b.1 | `primaryMode` becomes the only display-mode state                 | —             |
| T20b.2 | Columns/toolbar as `useMemo` derivations; delete flow pub-sub     | T20b.1, T20b.3  |
| T20b.3 | Split `MusicDownloadFlow` into plain modules + explicit `init`    | T20b.1         |
| T20b.4 | `TaskOrchestrator` (engine only); delete `flow-base.ts`           | T20b.2, T20b.3  |
| T20b.5 | Remove flow props/guards from the component tree; delete dead code| T20b.3, T20b.4  |
| T20b.6 | Drop `Task.flowId`; settings/sessions key migration               | T20b.5         |
| T20b.7 | Relocate bridges; optional folder rename (+ docs sweep)           | T20b.4, T20b.5  |
| T20b.8 | Per-step verification, behavior checklist, grep gate              | T20b.1–T20b.7   |

**Sequencing note:** if adopted, do P20b *before* implementing P21–P28 — they touch the same seams (`createTasksFromUrls`, contextual actions, settings items), and building them on the de-classed modules avoids refactoring each one twice. The P21–P28 docs' file references stay greppable either way.

---

## Implementation status (done)

All tasks landed in one commit. Where each piece lives:

- **T20b.1** ✅ `primaryMode` is React state in `App.tsx`, passed into `FocusProvider` (`onPrimaryModeChange`); `useFocusManager` keeps `subTab` derivation in `setPrimaryMode` and injects the mode back into the `secondaryPanel` slice so consumers (Toolbar's tab bar) are unchanged. `switchMode` deleted everywhere.
- **T20b.2** ✅ `columns = useMemo(computeColumns(primaryMode), [primaryMode, settingsVersion])` with the new `src/hooks/useSettingsVersion.ts`; `TOOLBAR_BUTTONS` module constant in `src/components/Toolbar/toolbarButtons.ts`. The flow-subscription mirroring effect and its structural-equality workaround are gone.
- **T20b.3** ✅ New modules in `src/flows/musicDownloadFlow/`: `registries.ts`, `taskFactory.ts`, `runController.ts`, `taskColumns.ts`, `contextualActions.ts`, `init.ts` (+ accessors in `settings.ts`, `buildMusicSettingsItems` wrapper in `buildFlowSettingsItems.ts`). `initMusicApp()` is called from `index.tsx start()` — no more registration inside a `useState` initializer. `musicDownloadFlow.ts` deleted (689 lines).
- **T20b.4** ✅ `TaskOrchestrator` at `src/base/task/orchestrator.ts` — flow registry surface deleted; the P20 pump untouched. `flow-base.ts` / `flow-settings.ts` deleted.
- **T20b.5** ✅ All `flow`/`currentFlow`/`orchestrator` props removed from `AppInner`, `Toolbar`, `ToolbarButtonInvoker`, `TaskListPanel`, `TaskRow`, `ActionBar`, `SecondaryPanel`, `InputRouter`, `SessionsModal`, `SettingsModal`, `useImportFlow`, `useKeyHandlers`; `ColumnComponentProps.flow` dropped (no cell used it). `FlowSelector.tsx` and `useImportButton.ts` deleted. The action-bar builder takes the caller's `columns` so there is exactly one column source.
- **T20b.6** ✅ `Task.flowId`/`getFlowId()` removed; `env.ts` uses `patchMusicSettings`; `settings.json` migrates `flows["music-downloader"]` → `music` silently on load; `StoredSession.flowId` optional (ignored on read, no longer written).
- **T20b.7** ✅ Bridges moved to `src/base/bridges/`; `src/base/flow/` removed. The optional folder rename (`src/flows/musicDownloadFlow/` → `src/music/`) was **skipped** as allowed — P21–P28 doc references stay valid.
- **T20b.8** ✅ `yarn type-check` clean; `yarn lint` clean (2 pre-existing WelcomeModal warnings); vitest 17/17 (unit + e2e smoke + render-profile budgets); `switch-view-column` harness scenario verifies `1`/`2` mode switching end-to-end; grep gate returns zero hits for `FlowBase|FlowClass|registerFlow|getAllFlows|getEnabledFlows|getFlowId|activeFlowId|currentFlow|FlowSelector|switchMode|FlowOrchestrator|base/flow`.

**Deviations from the plan:** `PrimaryMode` type lives in `taskColumns.ts` (focus manager keeps inline unions to avoid a hooks→flows import); the settings-items wrapper stayed in `buildFlowSettingsItems.ts` instead of a new file; `SettingsModal` only rewrites music settings when the draft patch is non-empty (previously it always rewrote them on save).
