# P1 — Global Keyboard / Input System: Tasks

## Context

**Current state of keyboard handling:**

There are four `useInput` registrations spread across the component tree:

| Component | Handles |
|-----------|---------|
| `App.tsx` | `Tab` (window cycle), digits `1–9` (mode switch) |
| `Toolbar.tsx` | `←` `→` `↓` (button navigation) |
| `TaskListPanel.tsx` | Arrow keys (row/column navigation), `Shift+↑/↓` (resize), contextual action dispatch |
| `PromptModal.tsx` | `Esc` (cancel), `y/n` (confirm), text input submit |

Each `useInput` adds a listener to the stdin EventEmitter — hence `setMaxListeners(30)` in `App.tsx` (line 36).

**Critical bug — two separate `useFocusManager` instances:**

`App.tsx` (line 87) calls `useFocusManager()` directly to get its own instance. Then it renders `<FocusProvider>` (line 120), which calls `useFocusManager()` again internally. These are two completely separate React state trees.

The `useInput` in `App.tsx` calls `focusManager.handleTabPress()` on the App-level instance — so pressing `Tab` changes state that nothing reads. `Toolbar`, `TaskListPanel`, and `PromptModal` all use `useFocusContext()` which returns the Provider's instance. Tab is currently broken.

Digits work only because the handler calls `currentFlow.switchMode(input)`, which operates on an external object (the flow) rather than the orphaned focusManager state.

**What needs to exist after P1:**

A single `useInput` at the root. A single `FocusState` instance. A dispatch table that maps the active window to the right handler. Contextual action data driven by focus context, not by individual panels.

---

## Tasks

### T1.1 — Fix the duplicate `useFocusManager` instantiation

`App.tsx` calls `useFocusManager()` at line 87 and also renders `<FocusProvider>` which calls it again. Remove the direct `useFocusManager()` call from `App.tsx`. Access all focus state through `useFocusContext()` instead (after the Provider renders). Move the `useWhyDidYouUpdate` debug call that reads from `focusManager` to use `useFocusContext()` or remove it.

This also means the `useInput` in `App.tsx` can no longer call `focusManager.handleTabPress()` — that wiring is fixed as part of T1.3.

*Depends on: nothing*

---

### T1.2 — Extend `FocusState` to cover all target panels

`FocusState` currently knows about: `toolbar`, `taskList`, `logPanel`, `footer`, `prompt`. The target UI adds more focusable windows: `rightPanel` (the metadata/download/logs detail panel), `settingsModal`, and `importModal`.

Add to `FocusState`:

```typescript
rightPanel: {
  mode: 'metadataSources' | 'download' | 'logs';
  selectedRowIndex: number;
  scrollOffset: number;
};
modal: {
  type: 'settings' | 'import' | null;
};
```

Add `'rightPanel' | 'settingsModal' | 'importModal'` to the `FocusableWindow` union. Update `handleTabPress()` to cycle `toolbar → taskList → rightPanel` (and skip modal windows, which steal focus programmatically). Initialize all new fields in the initial state object.

Do this before other panels are built so the shape doesn't need restructuring again.

*Depends on: T1.1*

---

### T1.3 — Consolidate all `useInput` registrations into one root dispatcher

Replace the four separate `useInput` hooks with a single one in `App.tsx` (or a dedicated `<InputRouter>` component rendered inside `<FocusProvider>`). The dispatcher reads `focusState.activeWindow` and calls only the handler registered for that window:

```typescript
const handlers: Record<FocusableWindow, KeyHandler> = {
  toolbar: toolbarHandler,
  taskList: taskListHandler,
  rightPanel: rightPanelHandler,
  prompt: promptHandler,
  // ...
};

useInput((input, key) => {
  // Global shortcuts first (Tab, Esc to close modal, etc.)
  if (key.tab) { focusManager.handleTabPress(); return; }

  // Delegate to active window
  handlers[focusState.activeWindow]?.(input, key);
});
```

Remove the `useInput` calls from `Toolbar.tsx`, `TaskListPanel.tsx`, and `PromptModal.tsx`. Remove `setMaxListeners(30)`.

*Depends on: T1.1, T1.2*

---

### T1.4 — Define a `KeyHandler` type and per-window handler functions

In a new file `src/hooks/useKeyHandlers.ts`, define:

```typescript
export type KeyHandler = (input: string, key: Key) => void;
```

Create one handler function per focusable window. Each function receives the current `focusState` and `focusManager` via closure (from `useFocusContext()` in the parent hook). Example:

```typescript
export function useToolbarKeyHandler(): KeyHandler { ... }
export function useTaskListKeyHandler(): KeyHandler { ... }
export function usePromptKeyHandler(): KeyHandler { ... }
```

The root dispatcher (T1.3) calls these hooks and builds the handler map. This keeps each panel's key logic co-located and independently testable.

*Depends on: T1.3*

---

### T1.5 — Fix the `Shortcut` type to support modifier keys

The `Shortcut` type in `src/components/TaskListPanel.tsx`:

```typescript
export type Shortcut = {
  key?: keyof Key;
  input?: string;
};
```

Has no `ctrl` or `shift` fields. The contextual action matcher in `TaskListPanel.tsx` logs `key.ctrl` but never requires it, so `Ctrl+V` would match the same as `V`. The target shortcuts include `[Ctrl+V]` (import), `[Ctrl+S]` (save settings), `[Ctrl+M]` (open in Picard), `[Ctrl+F]` (relocate file), and `[Shift+↑/↓]` (reorder sources).

Update `Shortcut`:

```typescript
export type Shortcut = {
  key?: keyof Key;
  input?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
};
```

Update the matcher (currently inside `TaskListPanel.tsx`'s `useInput`, will move to the dispatcher after T1.4) to check all modifier fields before declaring a match.

*Depends on: T1.4*

---

### T1.6 — Migrate `Toolbar` key handling to the centralized dispatcher

`Toolbar.tsx` has a `useInput({ isActive })` that calls:
- `focusManager.moveToolbarSelection('left')` on `←`
- `focusManager.moveToolbarSelection('right')` on `→`
- `focusManager.moveToolbarSelection('down')` on `↓`

Move this logic into `useToolbarKeyHandler()` (from T1.4). Remove the `useInput` from `Toolbar.tsx`. `Toolbar` no longer handles any key events directly — it only renders.

*Depends on: T1.4*

---

### T1.7 — Migrate `TaskListPanel` key handling to the centralized dispatcher

`TaskListPanel.tsx` has a `useInput({ isActive })` that handles:
- Arrow keys → `focusManager.moveTaskSelection()`
- `Shift+↑/↓` → `focusManager.resizeTaskList()`
- Contextual action dispatch (iterate `contextualActionBar.actions`, find matching shortcut, call `onClick`)

Move the entire handler body into `useTaskListKeyHandler()` (from T1.4). `TaskListPanel` stops handling key events and only renders.

The contextual action dispatch logic can stay structurally the same — it just runs inside the handler function rather than a `useInput` callback.

*Depends on: T1.4, T1.5*

---

### T1.8 — Migrate `PromptModal` key handling to the centralized dispatcher

`PromptModal.tsx` has a `useInput({ isActive })` for `Esc` and `y/n` confirm. Move this into `usePromptKeyHandler()`. `PromptModal` stops handling key events and only renders.

Note: `PromptModal` also uses `TextInput` from `ink-text-input` (for free-form env var input) and `SelectInput` from `ink-select-input`. Both packages register their own internal `useInput` hooks — this cannot be avoided. The goal is to eliminate the *manually registered* `useInput` from `PromptModal`; the third-party components are acceptable.

*Depends on: T1.4*

---

### T1.9 — Move contextual action bar out of `TaskListPanel` into the root layout

The contextual action bar is currently computed inside `TaskListPanel` via `flow.getContextualActionBar(task, { columnIndex })` and rendered at the bottom of the panel. As the right panel (P4, P5) and settings modal (P7) gain their own contextual actions, each panel will need to contribute to the bar.

Extract the bar into a standalone `<ActionBar>` component rendered in the root layout (between the pane area and the footer), driven by a `getContextualActions(focusState) → ContextualActionBar` call. Each panel registers its action provider with the router rather than rendering its own bar inline.

The `getContextualActionBar` method on `FlowBase` stays as the data source for taskList actions; the flow just needs to be called from outside TaskListPanel.

*Depends on: T1.2, T1.4*

---

### T1.10 — Multi-select support in the task list

Users need to select multiple tasks at once to perform batch operations (e.g., "Start all selected", "Delete all selected"). Multi-select coexists with the existing single-cursor navigation.

**State changes in `FocusState.taskList`:**

```typescript
taskList: {
  selectedTaskIndex: number;     // cursor position (unchanged)
  selectedColumnIndex: number;   // unchanged
  selectedTaskIds: Set<string>;  // NEW — the multi-select set
  // ...
};
```

`selectedTaskIds` is independent of `selectedTaskIndex`. The cursor can move freely without deselecting. Tasks in `selectedTaskIds` get a distinct visual indicator (e.g., `✓` prefix) different from the cursor indicator (`☛`).

**Key bindings:**

- `Space` (when `taskList` is focused and no column action is bound to Space) → toggle the task under the cursor into/out of `selectedTaskIds`
- `Ctrl+A` → select all tasks / deselect all (toggle)
- `Esc` → clear `selectedTaskIds`

**Contextual action gating:**

When `selectedTaskIds.size > 1`, the contextual action bar must only show actions that are valid for a multi-selection. Each `ContextualActions` entry needs a `multiSelectAllowed?: boolean` field. Actions without this flag are hidden when multiple tasks are selected. Batch-only actions (e.g., "Start all selected") set `multiSelectOnly: true` and are hidden when only one task is selected (to avoid duplicating single-task actions).

**Dispatcher changes:**

`useTaskListKeyHandler` (T1.7) handles `Space` and `Ctrl+A` and calls `focusManager.toggleTaskSelection(taskId)` / `focusManager.selectAll()` / `focusManager.clearSelection()`. These are new methods on `useFocusManager`.

The action dispatcher in `TaskListPanel` (or the root action bar after T1.9) iterates over `selectedTaskIds` when calling `onClick` for batch-capable actions.

*Depends on: T1.2, T1.4, T1.7*

---

## Summary

| Task | What | Depends on |
|------|------|-----------|
| T1.1 | Remove duplicate `useFocusManager` in `App.tsx` | — |
| T1.2 | Extend `FocusState` for all target panels | T1.1 |
| T1.3 | Single root `useInput` dispatcher | T1.1, T1.2 |
| T1.4 | `KeyHandler` type + per-window handler functions | T1.3 |
| T1.5 | Add `ctrl`/`shift` modifiers to `Shortcut` type | T1.4 |
| T1.6 | Migrate `Toolbar` key handling | T1.4 |
| T1.7 | Migrate `TaskListPanel` key handling | T1.4, T1.5 |
| T1.8 | Migrate `PromptModal` key handling | T1.4 |
| T1.9 | Move action bar to root layout | T1.2, T1.4 |
| T1.10 | Multi-select support | T1.2, T1.4, T1.7 |
