# UI Components

The UI is built with [Ink](https://github.com/vadimdemedes/ink) — a React renderer that targets the terminal instead of the DOM. Components are standard React functional components using hooks.

## Entry Point (`src/index.tsx`)

`src/index.tsx` does the following before mounting React:

1. Overrides `console.log/error/warn` to route through `globalLogger` (prevents raw output corrupting the terminal)
2. Registers a global `unhandledRejection` handler (logs but does not exit)
3. Calls `render(<App />, options)` with `{ patchConsole: true, maxFps: 60, exitOnCtrlC: false }`

There is also a `withFullScreen` helper defined in the file that wraps Ink's `render()` to manage the alternate screen buffer, but it is currently commented out — `render(<App />)` is used directly.

A `sound-play` call inside `App.tsx` plays `init.wav` on first mount (hardcoded absolute path — dev artifact).

## App (`src/components/App.tsx`)

Root component. Responsible for:

**Initialization (on mount via `useEffect`):**
- Registers `MusicDownloadFlow` with the orchestrator
- Sets the active flow to the first enabled flow

**Subscriptions:**
- Subscribes to the active flow to update `toolbarButtons` and `columns` when flow state changes (e.g. display mode switch)
- Subscribes to the orchestrator to update `tasks` when the task list changes

**Filtering:**
- Computes `filteredTasks` — only tasks belonging to the active flow

**Global keyboard handling (`useInput`):**
- `Tab` → `focusManager.handleTabPress()` (cycles between windows)
- Digits `1–9` → `currentFlow.switchMode(input)` (switch display mode)

**Layout rendered:**
```
<Text> color swatches (dev artifact — visible in terminal)
<BigText text="Goblin Malin" />
<Box flexDirection="column" height={terminalHeight}>
  <Toolbar />
  <TaskListPanel />
  <Separator />
  <LogPanel />
  <Separator />
  <Footer />
  <PromptModal />  ← rendered on top when a prompt is active
</Box>
```

## Toolbar (`src/components/Toolbar.tsx`)

Renders a horizontal row of buttons. Each button is defined by a `ToolbarButtonHook` — a React hook function called at render time that returns `{ label, icon, color, enabled, onClick }`.

The active flow's `getToolbarButtons()` returns the list of hooks. This means toolbar buttons are flow-specific and dynamically change when the flow changes.

## TaskListPanel (`src/components/TaskListPanel.tsx`)

The main task table. Receives:
- `columns: ColumnDefinition[]` — the dynamic list of columns from the active flow
- `tasks: Task[]` — filtered tasks for the active flow
- `flow` — used for contextual actions

Column widths are computed from `weight` values: each column gets `(weight / totalWeight) * availableWidth` characters. A fixed prefix `"☛ "` is reserved for the selection indicator.

Renders a header row then one `<TaskRow>` per task.

## TaskRow (`src/components/TaskRow.tsx`)

Renders one task as a row of cells. For each column in the column list, it renders the column's `component` (a React component), passing the task and its attributes as props. Cell components are defined per-flow (e.g. `SpotifyCell`, `YtDlpCell`).

When the row is focused (selected), a `"☛ "` indicator is shown at the left. The contextual action bar at the bottom of the panel is driven by which column within a focused row is selected.

## Column Cell Components (`src/flows/musicDownloadFlow/columns/`)

Each column has a dedicated cell component. Provider-specific columns (`SpotifyCell`, `YoutubeCell`, `YtDlpCell`) receive the full task and read from `task.attributes.metadataSources` or `task.attributes.downloadSources` to display status, track name, or download state.

`SERVICE_DISPLAY_MAPPING` in `musicDownloadFlow.ts` maps service keys to display metadata (acronym, color, component), and is used by `getColumns()` to build column definitions dynamically from the registry.

## PromptModal (`src/components/PromptModal.tsx`)

A centered overlay rendered when a task has an active `TaskPrompt`. The `useActivePrompt` hook scans all tasks for one with `prompt.get() !== null`. When found, the modal renders over the main UI and captures keyboard input for that prompt.

## LogPanel (`src/components/LogPanel.tsx`)

Scrollable log viewer at the bottom. Subscribes to the `InkTransport` log subscriber to receive new log entries. Displays the most recent logs, up to a maximum of 300 stored in the transport's in-memory array.

## Focus Management (`src/hooks/useFocusManager.ts`, `src/contexts/FocusContext.tsx`)

`useFocusManager` manages which UI window has keyboard focus and the selection within each window. Focus windows: `toolbar`, `taskList`, `logs`.

`FocusContext` (React context) broadcasts the focus state to all child components so they can determine if they are focused and render accordingly (e.g. highlight the selected row, highlight the selected column).

`handleTabPress()` cycles through windows in order. Arrow keys navigate within the focused window.

## Screen Size (`src/hooks/useScreenSize.ts`)

Reads `process.stdout.columns` and `process.stdout.rows` and re-reads them on terminal resize events. Used by `App.tsx` to pass `terminalWidth` and `terminalHeight` to layout components.
