# P2 — Split-Pane Layout: Tasks

## Context

**Current layout (vertical stack):**

```
┌─────────────────────────────────────────────────────┐
│ Toolbar                                              │
├─────────────────────────────────────────────────────┤
│ TaskListPanel (height = 30, hardcoded)               │
│   [header row]                                       │
│   [task rows...]                                     │
│   [contextual action bar]                            │
├─────────────────────────────────────────────────────┤
│ LogPanel (height = terminal - 30 - toolbar - footer) │
├─────────────────────────────────────────────────────┤
│ Footer                                               │
└─────────────────────────────────────────────────────┘
```

**Target layout (horizontal split with tab hierarchy):**

```
┌─────────────────────────────────────────────────────┐
│ Toolbar    [1] Metadata  [2] Download                │  ← primary mode tabs
├───────────────────────┬─────────────────────────────┤
│ Left pane             │ Right pane                   │
│ (task table)          │ [3] Meta Sources  [4] Logs   │  ← right-pane sub-tabs
│                       ├──────────────┬──────────────┤
│  columns depend on    │ Source list  │ Source detail │  ← inner split (tab [3] only)
│  active primary tab   │ (Spotify,    │ (track name,  │
│                       │  YouTube…)   │  artists…)    │
│                       │              │               │
└───────────────────────┴──────────────┴───────────────┘
│ Footer / Action Bar                                  │
└─────────────────────────────────────────────────────┘
```

**Key mapping:**

| Key   | Effect                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| `[1]` | Primary mode → Metadata: left pane shows metadata columns, right pane sub-tab defaults to "Metadata Sources" |
| `[2]` | Primary mode → Download: left pane shows download columns, right pane sub-tab defaults to "Download Sources" |
| `[3]` | Right pane → context-aware sources tab ("Metadata Sources" in mode `[1]`, "Download Sources" in mode `[2]`)  |
| `[4]` | Right pane → Logs                                                                                            |

**Right pane tab `[3]` inner split:**

Both "Metadata Sources" and "Download Sources" views are themselves horizontally split:

- Left side: scrollable list of sources (Spotify, YouTube, etc. — or yt-dlp, Soulseek)
- Right side: full field detail for the selected source (track name, artists, ISRC, album, year, BPM, etc.)

Pane widths are adjustable with `[Shift+↑/↓]` while a pane is focused.

**Key current issues to address:**

- `useFocusManager.ts` uses module-level hardcoded constants (`TASK_LIST_HEIGHT = 30`, `TOOLBAR_HEIGHT = 1`, etc.) that don't adapt to terminal size
- `App.tsx` has dev artifacts (hardcoded sound file path, color swatches, BigText) that conflict with layout restructuring
- `LogPanel` is rendered as a sibling of `TaskListPanel` in `App.tsx` but belongs inside the right pane

**Dependency on P1:** T2.3, T2.7, and T2.8 depend on P1's `FocusState` extensions (P1/T1.2) and centralized dispatcher (P1/T1.3). The layout restructuring (T2.4, T2.5) can proceed before P1 is complete; the keyboard wiring tasks cannot.

---

## Tasks

### T2.1 — Remove dev artifacts from `App.tsx`

Remove before restructuring the layout, as these will create conflicts:

- **`soundPlay.play(...)` call** (lines 27–30): hardcoded absolute path `C:\Users\axel7\...\init.wav`. Remove the entire `useEffect` and the `soundPlay` import.
- **Color swatch `<Text>` blocks** (lines 127–145): 18 lines of debug color output rendered directly to the terminal. Remove all of them.
- **`<BigText text="Goblin Malin" />`** (line 145): dev placeholder title. Remove with its `ink-big-text` import.
- **Unused imports**: `Image`, `TerminalInfoProvider` from `ink-picture`, `Gradient` from `ink-gradient`, `Color` from `chalk`. Remove all — they are either commented out or only used by the above artifacts.
- **`useWhyDidYouUpdate`** (line 108): debug hook from `src/utils/useWhyDidYouUpdate.ts`. Remove the call from `App.tsx` (the hook file itself can stay).

_Depends on: nothing_

---

### T2.2 — Replace hardcoded layout constants with dynamic calculation

`useFocusManager.ts` defines at module level:

```typescript
const TOOLBAR_HEIGHT = 1;
const TASK_LIST_HEIGHT = 30;
const FOOTER_HEIGHT = 2;
const SEPARATOR_HEIGHT = 4;
```

These constants don't adapt to terminal size and will break the split-pane calculation. Replace with a single config object of truly fixed values (rows that never change regardless of terminal size):

```typescript
const LAYOUT = {
  toolbarRows: 3, // toolbar line + 2 separator lines
  footerRows: 1,
} as const;
```

Compute the available content area dynamically:

```typescript
const contentHeight = terminalHeight - LAYOUT.toolbarRows - LAYOUT.footerRows;
```

Remove `TASK_LIST_HEIGHT` entirely — left pane height is always `contentHeight`. Remove `calculateLogPanelHeight()` — it no longer applies.

_Depends on: nothing_

---

### T2.3 — Add pane dimension state to `FocusState`

Add a `layout` section to `FocusState` (alongside the `secondaryPanel` and `modal` sections added in P1/T1.2):

```typescript
layout: {
  leftPaneWidth: number; // columns allocated to the task table
  rightPaneWidth: number; // columns allocated to the right panel
  contentHeight: number; // rows available for both panes (terminal - toolbar - footer)
}
```

Initialize `leftPaneWidth` and `rightPaneWidth` to roughly 50/50 of `terminalWidth`. Update the `terminalWidth` resize effect in `useFocusManager` to also recalculate these (preserving ratio, or resetting to 50/50 on resize).

Replace `taskList.height` and `logPanel.height` in the existing `FocusState` fields with references to `layout.contentHeight`. Remove the `resizeTaskList()` function and replace it with `resizeLeftPane(direction: 'shrink' | 'grow')` which adjusts `leftPaneWidth` / `rightPaneWidth` symmetrically, with a minimum of 20 columns each.

_Depends on: P1/T1.2_

---

### T2.4 — Restructure `App.tsx` layout from vertical stack to split-pane

Change the main content area from:

```tsx
<TaskListPanel ... />
<Separator />
<LogPanel ... />
```

To a horizontal split:

```tsx
<Box flexDirection="row" height={contentHeight}>
  <LeftPane width={leftPaneWidth} height={contentHeight} ... />
  <Box width={1} height={contentHeight}><Separator vertical /></Box>
  <RightPane width={rightPaneWidth} height={contentHeight} ... />
</Box>
```

`LeftPane` is a thin wrapper around the existing `TaskListPanel` with explicit `width` and `height` props passed through. `RightPane` is the new component from T2.5.

The outer layout becomes:

```tsx
<Box flexDirection="column" height={terminalHeight}>
  <Toolbar ... />
  <Box flexDirection="row" flexGrow={1}>
    <LeftPane ... />
    <RightPane ... />
  </Box>
  <Footer />
</Box>
```

Remove `<Separator>` between TaskListPanel and LogPanel (no longer applies). Update `TaskListPanel` to use `width` and `height` from props rather than from `focusState.taskList.height` directly.

_Depends on: T2.1, T2.2, T2.3_

---

### T2.5 — Create `SecondaryPanel` scaffold with tab bar and sub-tab rendering

Create `src/components/SecondaryPanel.tsx`. It receives:

```typescript
interface RightPanelProps {
  primaryMode: "metadata" | "download"; // driven by [1]/[2]
  subTab: "sources" | "logs"; // driven by [3]/[4]
  selectedTask: Task | null;
  width: number;
  height: number;
  flow: FlowBase;
}
```

**Tab bar** (one row at the top of the right pane, styled like the primary mode tabs):

- Shows context-aware labels: `[3] Metadata Sources  [4] Logs` when `primaryMode === 'metadata'`, or `[3] Download Sources  [4] Logs` when `primaryMode === 'download'`
- Highlights the active sub-tab

**Content area** renders based on `subTab`:

- `'sources'` → `<SourcesPanel>` (see T2.9 for inner split — placeholder initially)
- `'logs'` → existing `LogPanel` with `width` and `height` passed through

The `primaryMode` and `subTab` values come from `focusState.secondaryPanel` (added in P1/T1.2 and T2.3). `selectedTask` is derived from `filteredTasks[focusState.taskList.selectedTaskIndex]` in `App.tsx`.

_Depends on: T2.4, P1/T1.2_

---

### T2.6 — Move `LogPanel` into `SecondaryPanel` as the `'logs'` view mode

`LogPanel` is currently rendered directly in `App.tsx`'s top-level layout. After T2.5, it renders inside `SecondaryPanel`. The only change in `LogPanel` itself is accepting and respecting explicit `width` and `height` props (currently it reads width from `focusState.logPanel.width` and height from `focusState.logPanel.height`). Switch those to use `layout.contentHeight` from the new layout state, or accept them as props.

Remove `LogPanel` from `App.tsx`'s direct render tree.

_Depends on: T2.5_

---

### T2.7 — Wire `[1]–[4]` digit shortcuts to the two-level mode system

Keys `[1]` and `[2]` are primary mode switches — they change both the left pane's columns and the right pane's default sub-tab. Keys `[3]` and `[4]` switch only the right pane's sub-tab without affecting the left pane.

After P1/T1.3 (centralized dispatcher), add to the global key handler:

```typescript
// [1] and [2]: change primary mode + reset right pane to default sub-tab
if (input === "1") {
  currentFlow.switchMode("metadata");
  focusManager.setPrimaryMode("metadata");
  focusManager.setRightSubTab("sources"); // default to sources tab
}
if (input === "2") {
  currentFlow.switchMode("download");
  focusManager.setPrimaryMode("download");
  focusManager.setRightSubTab("sources"); // default to sources tab
}

// [3] and [4]: switch right pane sub-tab only
if (input === "3") focusManager.setRightSubTab("sources");
if (input === "4") focusManager.setRightSubTab("logs");
```

`focusState.secondaryPanel` needs two fields: `primaryMode: 'metadata' | 'download'` and `subTab: 'sources' | 'logs'`. Add `setPrimaryMode` and `setRightSubTab` to `useFocusManager`. The label shown for `[3]` in the tab bar is derived from `primaryMode` at render time — no separate "metadataSources" vs "downloadSources" enum needed in state.

Before P1/T1.3 is ready, wire this in the existing `useInput` in `App.tsx`.

_Depends on: T2.5, P1/T1.3_

---

### T2.8 — Implement pane width resizing with `[Shift+↑/↓]`

Wire `Shift+↑` and `Shift+↓` (when the task list or right panel is focused) to call `focusManager.resizeLeftPane('shrink')` and `focusManager.resizeLeftPane('grow')` respectively. These are the same keys currently used for task-list height resizing (`resizeTaskList`), which is being replaced by `resizeLeftPane` in T2.3.

The `resizeLeftPane` implementation:

```typescript
const resizeLeftPane = useCallback(
  (direction: "grow" | "shrink") => {
    setFocusState((prev) => {
      const delta = direction === "grow" ? 2 : -2;
      const newLeft = Math.max(
        20,
        Math.min(prev.layout.leftPaneWidth + delta, terminalWidth - 20),
      );
      return {
        ...prev,
        layout: {
          ...prev.layout,
          leftPaneWidth: newLeft,
          rightPaneWidth: terminalWidth - newLeft - 1, // 1 for separator
        },
      };
    });
  },
  [terminalWidth],
);
```

After P1/T1.7, this wiring lives in `useTaskListKeyHandler`. Before that, it can remain in `TaskListPanel`'s existing `useInput`.

_Depends on: T2.3, P1/T1.5_

---

### T2.9 — Create `SourcesPanel` scaffold with inner left/right split

The `[3]` sub-tab in the right pane ("Metadata Sources" or "Download Sources") is itself a split view. Create `src/components/SourcesPanel.tsx`:

```typescript
interface SourcesPanelProps {
  mode: "metadata" | "download"; // determines what to list and display
  selectedTask: Task | null;
  width: number;
  height: number;
}
```

**Inner layout:**

```
┌───────────────────────┬──────────────────────────────┐
│ Source list           │ Source detail                 │
│ (left)                │ (right)                       │
│                       │                               │
│ width: ~40%           │ width: ~60%                   │
│                       │                               │
│ ● Spotify   SELECTED  │ Track: ...                    │
│ ○ YouTube             │ Artist: ...                   │
│ ○ MusicBrainz         │ ISRC: ...                     │
│                       │ Album: ...                    │
│                       │ Year: ...                     │
└───────────────────────┴──────────────────────────────┘
```

- **Source list**: one row per available source for the selected task. Shows platform badge, track name, duration. Arrow keys navigate the list. The selected source's full fields are shown in the right panel.
- **Source detail**: renders the full field set for the selected source. For `mode === 'metadata'`: title, artists, ISRC, album, album artists, year, track#, BPM, key, genres, MusicBrainz IDs. For `mode === 'download'`: filename, format, size, duration, all embedded tags.

For now, render placeholder content ("Metadata Sources panel — not yet implemented (P4)" / "Download Sources panel — not yet implemented (P5)"). The real implementations are P4 and P5 respectively. This task only establishes the inner split layout, the source list navigation state in `FocusState`, and the component boundaries.

Add `sourcesPanel: { selectedSourceIndex: number; innerFocus: 'list' | 'detail' }` to `focusState.secondaryPanel`. `Tab` (or `→`/`←`) switches inner focus between the list and detail sides.

_Depends on: T2.5, P1/T1.2_

---

## Summary

| Task | What                                                        | Depends on       |
| ---- | ----------------------------------------------------------- | ---------------- |
| T2.1 | Remove dev artifacts from `App.tsx`                         | —                |
| T2.2 | Replace hardcoded layout constants with dynamic calculation | —                |
| T2.3 | Add pane dimension state to `FocusState`                    | P1/T1.2          |
| T2.4 | Restructure `App.tsx` layout to split-pane                  | T2.1, T2.2, T2.3 |
| T2.5 | Create `SecondaryPanel` scaffold with tab bar               | T2.4, P1/T1.2    |
| T2.6 | Move `LogPanel` into `SecondaryPanel`                       | T2.5             |
| T2.7 | Wire `[1]–[4]` to the two-level mode system                 | T2.5, P1/T1.3    |
| T2.8 | Implement left/right pane width resizing                    | T2.3, P1/T1.5    |
| T2.9 | Create `SourcesPanel` with inner split layout               | T2.5, P1/T1.2    |
