# P12 — Global Input System

## Context

Before P12, each component called `useInput` independently and handled key events in isolation. This created three problems:

1. **Priority conflicts.** Multiple `useInput` handlers fired for every keystroke in undefined order. Modals had no reliable way to block lower-level handlers.
2. **No user-remappable shortcuts.** Keys were hardcoded at each call site with no central catalog.
3. **Hint bar was static.** `SourcesHintBar` was a per-panel, hard-coded component. Adding hints to a new component required threading props up the tree.

P12 replaces all ad-hoc `useInput` calls with a centralized `ShortcutRegistry`. Components register named shortcut contexts with a priority; the registry routes each key event to the highest-priority active handler that matches. A single `ShortcutDispatcher` holds the one `useInput` in the entire app. Hints are published into the registry and rendered by a shared `DynamicHintBar`. Bindings are user-overridable and persisted in `settings.json`.

---

## Architecture

### `ShortcutRegistry` (`src/base/shortcuts/ShortcutRegistry.ts`)

Singleton class. Maintains a map of `ContextRegistration` entries, each identified by a `contextId` string and carrying:

- `priority: number` — higher wins; modal contexts sit at 1000+, window contexts at 150, global at 50.
- `isActive: boolean` — inactive contexts do not receive key events and do not contribute to the hint bar.
- `exclusive: boolean` — when true, blocks all lower-priority contexts even when no shortcut matches (used for modals).
- `shortcuts: ShortcutEntry[]` — list of `{ id, defaultShortcut, shortcut, label, handler }`.
- `hintLines: HintLineEntry[]` — hint bar content for this context.

**Dispatch model:** on every key event, sort active contexts by priority descending; iterate; first matching shortcut fires and stops traversal; exclusive context stops traversal even on no-match.

**Rebind mode:** `enableRebind(callback)` intercepts the next key event and routes it exclusively to `callback` (used by the Shortcuts tab).

**Change detection:** `maybeNotify()` builds a stable string key from all active hints and shortcuts; subscribers are only called when the key changes, preventing unnecessary re-renders.

### `useShortcuts` hook (`src/hooks/useShortcuts.ts`)

Component-facing API. Accepts `id`, `isActive`, `priority`, `exclusive`, `shortcuts[]`, `hintLines[]`.

- **Synchronous first registration** — avoids a one-frame flash: if the context is not yet known, `register()` is called inline during render.
- **Every-render update** — `update()` is always called so `isActive`, hint content, and user keybinding overrides stay fresh without effects.
- **Stale-closure safety** — handlers are looked up from a `useRef` inside the registry entry so closures never go stale.
- **Unmount cleanup** — `useEffect` returns `() => shortcutRegistry.unregister(id)`.
- **Settings reactivity** — a `SettingsStore.onSettingsChanged` subscription re-syncs keybindings when the user saves a rebind.

### `ShortcutDispatcher` (`src/components/ShortcutDispatcher.tsx`)

The **only** `useInput` in the application. Two responsibilities:

1. URL-paste detection: if `input.length > 8` and matches `https?://`, open the import flow immediately (works even inside modals).
2. Everything else → `shortcutRegistry.dispatch(input, key)`.

Mounted once inside `AppInner`, above all panels and modals.

### `DynamicHintBar` (`src/components/DynamicHintBar/DynamicHintBar.tsx`)

Subscribes to `ShortcutRegistry` via `shortcutRegistry.subscribe(forceUpdate)`. On each render, calls `getActiveHintContexts()` (sorted by priority descending) and renders one `HintLine` per `HintLineEntry`.

Each `HintLine` has a left-side label (plain text or a React node via `renderNode`) and a list of `HintChip` components, one per referenced shortcut ID. Shortcut chips show the user's current binding (default or overridden).

Replaces the deleted `SourcesHintBar.tsx`.

### Keybindings storage

`AppSettings` gains `keybindings: Record<string, Shortcut>` (keyed by shortcut action ID). Stored in `settings.json` alongside `general`. `SettingsStore.setKeybinding(id, shortcut | null)` is the write path. Passing `null` removes the override (restores default).

### `matchesShortcut` fix (`src/types/actions.ts`)

Two behavioral corrections:

- **Character input:** `shift` is optional; unspecified → case-insensitive match (`{ input: "f" }` fires on both `f` and `Shift+F`). `ctrl`/`meta` must match if specified.
- **Named keys:** unspecified modifiers default to `false`. Prevents `Shift+Left` from accidentally triggering a handler registered as `{ key: "leftArrow" }` at higher priority.

### Settings — Shortcuts tab (`src/components/SettingsModal/ShortcutsTab.tsx`)

New tab in `SettingsModal` alongside the existing Settings tab. Shows every registered shortcut (pulled from `shortcutRegistry.getAllEntries()`), searchable by ID or label, with current binding and a custom-binding indicator.

**Rebind flow:** select a shortcut → `Enter` → `startRebind(id)` calls `shortcutRegistry.enableRebind(callback)` → next key press captured → `SettingsStore.setKeybinding(id, newShortcut)` → registry notified via `onSettingsChanged`.

---

## Files Changed

| File | Change |
| ---- | ------ |
| `src/base/shortcuts/ShortcutRegistry.ts` | New — singleton registry class + React context/provider |
| `src/hooks/useShortcuts.ts` | New — `useShortcuts` hook |
| `src/components/ShortcutDispatcher.tsx` | New — single `useInput` entry point |
| `src/components/DynamicHintBar/DynamicHintBar.tsx` | New — hint bar that reads from registry |
| `src/components/SettingsModal/ShortcutsTab.tsx` | New — Shortcuts tab with rebind UI |
| `src/components/SettingsModal/SettingsTab.tsx` | New — extracted from `SettingsModal.tsx` |
| `src/components/SecondaryPanel/SourcesHintBar.tsx` | Deleted — replaced by `DynamicHintBar` |
| `src/settings/appSettings.ts` | Add `keybindings` field |
| `src/settings/settingsStore.ts` | Persist keybindings; add `setKeybinding()` |
| `src/types/actions.ts` | Fix `matchesShortcut` modifier logic |
| `src/components/App.tsx` | Wrap tree in `ShortcutRegistryProvider` |
| `src/components/AppInner.tsx` | Mount `ShortcutDispatcher` |
| `src/components/InputRouter.tsx` | Rewrite global shortcuts with `useShortcuts` |
| `src/hooks/useKeyHandlers.ts` | Migrate toolbar/task-list/prompt handlers to `useShortcuts` |
| `src/components/SettingsModal/SettingsModal.tsx` | Migrate modal shortcuts; add Shortcuts tab; add rebind orchestration |
| `src/components/ImportModal/ImportModal.tsx` | Migrate to `useShortcuts` |
| `src/components/WelcomeModal/WelcomeModal.tsx` | Migrate to `useShortcuts` |
| `src/components/SetupWizardModal/SetupWizardModal.tsx` | Migrate to `useShortcuts` |
| `src/components/SecondaryPanel/DownloadPanel/DownloadPanel.tsx` | Migrate to `useShortcuts` + `DynamicHintBar` |
| `src/components/SecondaryPanel/DownloadPanel/DownloadSourceDetail/DownloadSourceDetail.tsx` | Migrate to `useShortcuts` |
| `src/components/SecondaryPanel/DownloadPanel/DownloadSourceTree/DownloadSourceTree.tsx` | Migrate to `useShortcuts` |
| `src/components/SecondaryPanel/LogPanel.tsx` | Migrate to `useShortcuts` |
| `src/components/SecondaryPanel/MetadataPanel/MetadataPanel.tsx` | Migrate to `useShortcuts` + `DynamicHintBar` |
| `src/components/SecondaryPanel/MetadataPanel/MetadataDetailPanel.tsx` | Migrate to `useShortcuts` |
| `src/components/SecondaryPanel/MetadataPanel/MetadataSourceList.tsx` | Remove inline hint rendering |
| `src/components/SecondaryPanel/MetadataPanel/useSourceListInput.ts` | Migrate to `useShortcuts` with hint lines |
| `src/hooks/useTask.ts` | Minor cleanup |

---

## Task List

| #   | Title                                                | Files                                               | Deps          | Status  |
| --- | ---------------------------------------------------- | --------------------------------------------------- | ------------- | ------- |
| T01 | `ShortcutRegistry` singleton + types                 | `ShortcutRegistry.ts`                               | —             | ✅ Done |
| T02 | `useShortcuts` hook                                  | `useShortcuts.ts`                                   | T01           | ✅ Done |
| T03 | `ShortcutDispatcher` — single `useInput`             | `ShortcutDispatcher.tsx`                            | T01           | ✅ Done |
| T04 | Keybindings storage                                  | `appSettings.ts`, `settingsStore.ts`                | —             | ✅ Done |
| T05 | Fix `matchesShortcut` modifier logic                 | `actions.ts`                                        | —             | ✅ Done |
| T06 | Wrap app in `ShortcutRegistryProvider`               | `App.tsx`                                           | T01           | ✅ Done |
| T07 | Mount `ShortcutDispatcher` in `AppInner`             | `AppInner.tsx`                                      | T03           | ✅ Done |
| T08 | Migrate global shortcuts (`InputRouter`)             | `InputRouter.tsx`                                   | T02           | ✅ Done |
| T09 | Migrate toolbar/task-list/prompt (`useKeyHandlers`)  | `useKeyHandlers.ts`                                 | T02           | ✅ Done |
| T10 | Migrate modals to `useShortcuts`                     | `ImportModal.tsx`, `WelcomeModal.tsx`, `SetupWizardModal.tsx` | T02 | ✅ Done |
| T11 | `DynamicHintBar` component                           | `DynamicHintBar.tsx`                                | T01           | ✅ Done |
| T12 | Migrate `MetadataPanel` panels + `useSourceListInput`| `MetadataPanel.tsx`, `MetadataDetailPanel.tsx`, `MetadataSourceList.tsx`, `useSourceListInput.ts` | T02, T11 | ✅ Done |
| T13 | Migrate `DownloadPanel` panels                       | `DownloadPanel.tsx`, `DownloadSourceDetail.tsx`, `DownloadSourceTree.tsx` | T02, T11 | ✅ Done |
| T14 | Migrate `LogPanel`                                   | `LogPanel.tsx`                                      | T02, T11      | ✅ Done |
| T15 | Delete `SourcesHintBar`                              | `SourcesHintBar.tsx`                                | T11, T12, T13 | ✅ Done |
| T16 | Extract `SettingsTab` component                      | `SettingsTab.tsx`                                   | —             | ✅ Done |
| T17 | `ShortcutsTab` component with rebind UI              | `ShortcutsTab.tsx`                                  | T01, T04      | ✅ Done |
| T18 | Wire Shortcuts tab into `SettingsModal`              | `SettingsModal.tsx`                                 | T16, T17      | ✅ Done |

All tasks completed.

---

## Architectural Notes & Risks

**Priority ladder:** modals use `exclusive: true` at priority 1000; window contexts (toolbar, task list, metadata panel, download panel) sit at 100–200; global shortcuts at 50. The gap between levels leaves room for future contexts without renumbering.

**Stale handlers:** handlers captured in registry entries read from a `useRef` that is updated every render. This means closures always see the latest state without requiring the registry entry to be rebuilt on each render.

**Synchronous first registration:** `useShortcuts` registers inline on first render (not in `useEffect`) to avoid a one-frame gap where `DynamicHintBar` would show no hints. Subsequent renders call `update()` instead.

**URL paste before dispatch:** URL detection runs in `ShortcutDispatcher` before `registry.dispatch()`, so it works even when an `exclusive` modal is active and would otherwise swallow all keys.

**Rebind and `isActive`:** while `rebindCallback` is set, `dispatch()` routes the entire key event to it, bypassing all registered contexts. This prevents a shortcut from firing at the same time as the rebind capture.

**`SourcesHintBar` removal:** the static per-panel hint bar is fully replaced by `DynamicHintBar`. Hint content is now owned by the context that defines the shortcuts, not by a separate sibling component.

---

## Verification

1. `yarn run type-check` — no new errors
2. `yarn run dev` — TUI starts; hint bar shows context-appropriate hints
3. Navigate between panels with Tab — hint bar updates per focused context
4. Open Settings modal — all shortcuts blocked; modal shortcuts (Ctrl+S, Esc) work
5. Settings → Shortcuts tab — all registered shortcuts listed; search filters
6. Select a shortcut, press Enter → "Press new shortcut key…" prompt appears; press a key → binding updates; press Esc → cancelled
7. Close and reopen Settings — custom binding persists (written to `settings.json`)
8. Paste a URL while a modal is open — import flow opens regardless
