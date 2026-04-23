# P2 — Two-Panel Layout: Tasks

## Context

**Implemented layout (vertical stack):**

```
┌─────────────────────────────────────────────────────┐
│ Toolbar              [1] Metadata  [2] Download      │  ← primary mode tabs in toolbar
├──────────────── [3] Metadata Sources  [4] Logs ──────┤  ← secondary panel tab bar (TabBar)
│ TaskListPanel (vertically resizable)                 │
│   [header row]                                       │
│   [task rows...]                                     │
│   [contextual action bar]                            │
├──────────────── [3] Metadata Sources  [4] Logs ──────┤  ← secondary panel tab bar
│ SecondaryPanel                                       │
│  ┌──────────────────────┬──────────────────────────┐ │
│  │ Source list           │ ┌── Metadata ───────────┐│ │
│  │ (placeholder)        │ │ Source detail          ││ │
│  │                      │ │ (gray box with title)  ││ │
│  │                      │ └────────────────────────┘│ │
│  └──────────────────────┴──────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ Footer                                               │
└─────────────────────────────────────────────────────┘
```

**Key mapping (implemented):**

| Key   | Effect                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------- |
| `[1]` | Primary mode → Metadata: task list shows metadata columns, `setPrimaryMode("metadata")`                         |
| `[2]` | Primary mode → Download: task list shows download columns, `setPrimaryMode("download")`                         |
| `[3]` | Secondary panel → context-aware sources tab (`setSecondaryTab("sources")`)                                      |
| `[4]` | Secondary panel → Logs (`setSecondaryTab("logs")`)                                                              |

> **Deviation from plan:** `[1]`/`[2]` do **not** reset the secondary tab to `"sources"` — the plan called for `setSecondaryTab("sources")` alongside `setPrimaryMode(...)`. Currently they only switch the primary mode.

---

## Tasks

### T2.1 — Remove dev artifacts from `App.tsx` — ⚠️ PARTIAL

Done:
- ✅ BigText `<BigText text="Goblin Malin" />` and its import removed (was already commented out, dead code removed)
- ✅ Color swatch `<Text>` debug blocks removed
- ✅ Hardcoded absolute sound path `C:\Users\axel7\...\init.wav` replaced with a `import.meta.url`-relative resolve

**Not done per plan:**
- ❌ `soundPlay.play(...)` `useEffect` kept (path was fixed rather than removed)
- ❌ `soundPlay`, `fileURLToPath`, `path` imports kept

_The plan called for full removal of the startup sound. The implementation chose to fix the path instead._

---

### T2.2 — Replace hardcoded layout constants with dynamic calculation — ✅ DONE

- ✅ `TOOLBAR_HEIGHT`, `TASK_LIST_HEIGHT`, `FOOTER_HEIGHT`, `SEPARATOR_HEIGHT` removed
- ✅ Replaced with `LAYOUT = { toolbarRows: 3, overheadRows: 4 }` fixed-rows object
- ✅ `computeContentHeight(terminalHeight)` helper added
- ✅ `initLayout(terminalHeight)` initializes `{ taskListHeight, secondaryPanelHeight, contentHeight }`
- ✅ `calculateLogPanelHeight()` removed

---

### T2.3 — Add panel dimension state to `FocusState` — ✅ DONE

- ✅ `layout: { taskListHeight, secondaryPanelHeight, contentHeight }` added to `FocusState`
- ✅ `taskList.height` and `logPanel.height` removed from `FocusState`
- ✅ Terminal resize effect recalculates layout proportionally (preserves ratio)
- ✅ `resizePanels(direction: 'grow' | 'shrink')` replaces `resizeTaskList()`
- ✅ `setPrimaryMode(mode)` and `setSecondaryTab(tab)` added to focus manager and context
- ✅ `secondaryPanel.mode` renamed to `primaryMode: 'metadata' | 'download'` + `subTab: 'sources' | 'logs'`
- ✅ `secondaryPanel.sourcesPanel: { selectedSourceIndex, innerFocus }` added

---

### T2.4 — Restructure `App.tsx` layout — ✅ DONE

- ✅ `LogPanel` removed from `App.tsx` direct render tree
- ✅ `SecondaryPanel` added in its place
- ✅ `Separator` between `TaskListPanel` and `SecondaryPanel` removed (tab bar replaces it)

> **Deviation from plan:** A `Separator` before `Footer` and the `ActionBar` component remain in `App.tsx`, which T2.4 did not explicitly plan for but were already present and kept.

---

### T2.5 — Create `SecondaryPanel` scaffold — ✅ DONE

- ✅ `SecondaryPanel.tsx` created (`src/components/SecondaryPanel.tsx`)
- ✅ Tab bar rendered via the new shared `TabBar` component (see extra work below)
- ✅ Routes to `<SourcesPanel>` (subTab `"sources"`) or `<LogPanel>` (subTab `"logs"`)
- ✅ `LogPanel` always mounted to preserve log history when switching tabs (zero-height hide technique)

---

### T2.6 — Move `LogPanel` into `SecondaryPanel` — ✅ DONE

- ✅ `LogPanel` accepts `width?: number` and `height?: number` props
- ✅ Falls back to `focusState.layout.secondaryPanelHeight` / `focusState.logPanel.width` if props omitted
- ✅ Rendered exclusively inside `SecondaryPanel`

---

### T2.7 — Wire `[1]–[4]` digit shortcuts — ✅ DONE (with deviation)

- ✅ Keys `[1]`–`[4]` wired in `InputRouter.tsx` (single root dispatcher)
- ✅ `[1]`/`[2]` call `switchMode(flow, input)` + `setPrimaryMode(...)`
- ✅ `[3]`/`[4]` call `setSecondaryTab(...)`
- ✅ Keys `[5]`–`[9]` remain as generic flow mode switches

> **Deviation from plan:** `[1]`/`[2]` do not call `setSecondaryTab("sources")` — secondary tab is not reset when switching primary mode.

---

### T2.8 — Implement panel height resizing — ✅ DONE

- ✅ `resizePanels('grow' | 'shrink')` implementation matches the spec exactly (delta ±2, min 5 rows each)
- ✅ Wired in `useKeyHandlers.ts`: `Shift+↑` → `resizePanels('shrink')`, `Shift+↓` → `resizePanels('grow')`

---

### T2.9 — Create `SourcesPanel` scaffold with inner split — ✅ DONE (+ extras)

- ✅ `SourcesPanel.tsx` created (`src/components/SourcesPanel.tsx`)
- ✅ Inner split: left (~40%) source list placeholder, right (~60%) source detail
- ✅ Placeholder text per mode: "Metadata Sources panel — not yet implemented (P4)" / "Download Sources panel — not yet implemented (P5)"
- ✅ `focusState.secondaryPanel.sourcesPanel: { selectedSourceIndex, innerFocus }` added (T2.3)

> **Extra beyond plan:** The right detail panel has a gray bordered box with a centered title (`Metadata` or `Download`) in the top border, implemented via a manually constructed top border row + `borderTop={false}` on the inner box.

---

## Extra work (not in original plan)

### TabBar component

A shared `TabBar` component (`src/components/TabBar.tsx`) was extracted to unify the tab bar rendering across `Toolbar` (primary mode tabs) and `SecondaryPanel` (sources/logs tabs). Props:

```typescript
interface TabBarProps {
  width: number;
  tabs: TabDef[];        // [{ key, label }]
  activeTabKey: string;
  splitPos?: number;     // if set, inserts ┴ junction at this x position
}
```

`Toolbar.tsx`'s internal `PrimaryModeTabBar` component and `SecondaryPanel.tsx`'s `TabSeparator` component were both replaced with `TabBar`.

---

## Summary

| Task | What                                                        | Status            |
| ---- | ----------------------------------------------------------- | ----------------- |
| T2.1 | Remove dev artifacts from `App.tsx`                         | ⚠️ Partial — sound path fixed, not removed |
| T2.2 | Replace hardcoded layout constants                          | ✅ Done           |
| T2.3 | Add panel dimension state to `FocusState`                   | ✅ Done           |
| T2.4 | Replace `LogPanel` with `SecondaryPanel` in `App.tsx`       | ✅ Done           |
| T2.5 | Create `SecondaryPanel` scaffold with tab bar               | ✅ Done           |
| T2.6 | Move `LogPanel` into `SecondaryPanel`                       | ✅ Done           |
| T2.7 | Wire `[1]–[4]` to the two-level mode system                 | ✅ Done (tab not reset on [1]/[2]) |
| T2.8 | Implement panel height resizing                             | ✅ Done           |
| T2.9 | Create `SourcesPanel` with inner split layout               | ✅ Done           |
| —    | `TabBar` shared component                                   | ✅ Extra           |
