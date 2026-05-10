# Projects

High-level technical projects needed to reach the target product described in the [root README](../../README.md) and [design screenshots](../designs/).

These are not task lists — each project is a self-contained scope of work. Individual tasks are broken out in each project's subfolder.

| Project                                        | Tasks                      |
| ---------------------------------------------- | -------------------------- |
| P1 — Global Keyboard / Input System            | [p1/tasks.md](p1/tasks.md) |
| P2 — Two-Panel Layout                          | [p2/tasks.md](p2/tasks.md) |
| P3 — Import System                             | [p3/tasks.md](p3/tasks.md) |
| P4 — Metadata Source Management Panel          | [p4/tasks.md](p4/tasks.md) |
| P5 — Download Source Selection & Audio Preview | [p5/tasks.md](p5/tasks.md) |
| P6 — Save Flow (Tag & Export)                  | [p6/tasks.md](p6/tasks.md) |
| P7 — Settings System                           | [p7/tasks.md](p7/tasks.md) |
| P8 — Provider Display Registry                 | [p8/tasks.md](p8/tasks.md) |
| P9 — Color Theme Unification                   | NOT WRITTEN                |
| P10 — Session management                       | NOT WRITTEN                |

---

## P1 — Global Keyboard / Input System ✅ Complete

**The biggest architectural risk.** The target UI has deeply context-sensitive keyboard shortcuts: the same key does a different thing depending on which panel is focused, which row is selected, and which column is active. The current approach — multiple `useInput` hooks scattered across components — already shows strain (`setMaxListeners(30)` in `App.tsx`). It will break down completely once the secondary panel, metadata source list, and download tree all need their own shortcuts simultaneously.

What's needed is a single centralized input router that:

- Knows the current "focus context" (active window + selection within it)
- Dispatches key events to the right handler without components fighting over them
- Renders the correct contextual action bar at the bottom from that context
- Supports **multi-select**: users can select multiple tasks simultaneously (e.g., `Space` to toggle, `Ctrl+A` to select all); contextual actions that are invalid for a multi-selection are hidden, and batch-only actions appear when multiple tasks are selected

This project touches almost every other project below, so it should be resolved or at least designed early. The existing `FocusContext` is a foundation but stops short of action dispatch.

---

## P2 — Two-Panel Layout ✅ Complete

The layout restructuring is done. `LogPanel` is replaced by `SecondaryPanel` in `App.tsx`. The two-level tab system (`[1]`/`[2]` primary mode, `[3]`/`[4]` secondary tab), resizable panel heights (`Shift+↑/↓`), and dynamic layout state are all implemented.

**What's in place:**

- `SecondaryPanel` with a shared `TabBar` component (also used in `Toolbar`)
- `SourcesPanel` inner split (left source list, right detail box with gray border + centered title)
- `FocusState.layout` drives all panel heights dynamically; resizes proportionally on terminal resize
- Keys `[1]`–`[4]` wired in `InputRouter` (single root dispatcher)
- `LogPanel` always mounted inside `SecondaryPanel` (preserves log history across tab switches)

**Known gaps vs original plan:**

- `[1]`/`[2]` do not reset the secondary tab to `"sources"` when switching primary mode
- `soundPlay` startup sound was path-fixed rather than removed (T2.1 partial)

See [p2/tasks.md](p2/tasks.md) for full task-by-task status.

---

## P3 — Import System ✅ Complete

The current import reads `inputs.txt` from disk on button press. The target is clipboard-driven:

- `Ctrl+V` pastes clipboard content anywhere on the main screen
- The app detects all valid URLs in the pasted text
- A **confirmation modal** lists the detected URLs (with clickable links) and asks `[ENTER]` to confirm or `[Esc]` to cancel
- The modal footer has two checkboxes that apply to **all** URLs being imported:
  - **Fetch Metadata?** — if checked, `toTag` is set on each created task (triggers auto-fetch on import)
  - **Download?** — if checked, `toDownload` is set on each created task (triggers auto-download on import)
- Confirmed URLs are added as tasks with the selected flags

This replaces the `inputs.txt` mechanism entirely and requires:

- A clipboard read API (Node's `child_process` or a package, since Ink has no native clipboard access)
- A URL detection/parsing step that identifies supported platforms
- A new confirmation modal component with keyboard-navigable checkboxes
- Handling re-import gracefully (URLs already in the queue should be skipped rather than throwing)

---

## P4 — Metadata Source Management Panel ✅ Complete

All tasks (T4.1–T4.13) are implemented. The metadata sources panel is fully functional.

**What's in place:**

- `MetadataSourceState` wrapper with `rank`, `isFavorited`, `isRejected`, `confidence` fields; `MetadataOverrides` type; `bpm`/`key`/`genres` added to `BaseTrackMetadata`
- `computeCompiledMetadata()` — pure aggregation with per-field `attribution` map and manual override support
- `computeConfidenceScore()` — 0–100 match score per source vs. primary; stored on upsert in `addMetadataSource` / `upsertMetadataSource`
- `MetadataSourceList` — scrollable ranked list with trophy compiled row, confidence badges (`[NNN%]` color-coded), status icons (`★`/`✘`/`?`)
- `MetadataDetailPanel` — full field view with attribution badges; inline `TextInput` editing for compiled overrides; `FieldRow`, `MetadataCompiledRow`, `MetadataSourceRow` sub-components
- `SourcesHintBar` — two-row contextual shortcuts bar: source context path on row 1, position counter + list actions on row 2
- `SourcesPanel` subscribes to task changes via `task.subscribe()` to re-render on mutations
- `[F]` favorite, `[Del]` reject, `[Shift+↑/↓]` reorder, `[S]` re-search single provider via `startSingleProviderSearch()` — all working
- `useSourceListInput` hook encapsulates all source-list keyboard handling
- `metadataFields.ts` defines all editable field definitions (label, getter, parser, formatter)

**Component locations** (all under `src/components/SecondaryPanel/MetadataPanel/`):

`MetadataSourceList.tsx`, `MetadataDetailPanel.tsx`, `FieldRow.tsx`, `MetadataCompiledRow.tsx`, `MetadataSourceRow.tsx`, `SourcesHintBar.tsx`, `SourcesPanel.tsx`

See [p4/tasks.md](p4/tasks.md) for full task-by-task detail.

---

## P5 — Download Source Selection & Audio Preview Panel ✅ Complete

All core tasks are implemented. The download panel is fully functional.

**What's in place:**

- `DownloadPanel` mounts in `SecondaryPanel` when `primaryMode === "download"` (tab `[3]`)
- `DownloadSourceTree` — left pane, groups sources by provider header → metadata-source header → file row; `↑/↓` navigates selectable rows; `[Enter]` requests selection, `[Del]` toggles reject, `[Space]` plays the file directly from the list
- `DownloadSourceDetail` — right pane, shows format / size / duration / all embedded tags (priority tags first, then others); `[Space]` play/pause, `[Shift+←/→]` seek ±5 s; "File not found" warning with `[Ctrl+F]` relocate flow (prompts for new absolute path via `askInput`)
- `PlaybackBar` — progress bar with ▶/⏸ icon, filled/unfilled block characters, position/duration timestamps; driven by `MpvPlayer` `progress` and `stateChange` events
- `StateBadge` — per-row state indicator (DOWNLOADED / SAVED / failed)
- `DiffView` — side-by-side old vs. new panel shown when switching the selected source after a file is already saved; `[Enter]` confirms the switch, `[Esc]` cancels
- `Shift+←/→` resizes the left/right split ratio (only when list pane is focused; detail pane owns those keys for seek)
- `readFileInfo.ts` — reads `fs.stat` + `flac-tagger` tags on download completion and populates `FileInfo` on the source

**Audio backend** (`src/utils/mpvPlayer.ts`, `src/utils/mpv-setup.ts`):

- Custom direct-IPC `MpvPlayer` class (no `node-mpv` dependency) — see [p5/play-music-audit.md](p5/play-music-audit.md#what-was-actually-built)
- On Windows: mpv binary is auto-downloaded from shinchiro/mpv-winbuild-cmake; on macOS/Linux: uses system `mpv` from PATH

See [p5/tasks.md](p5/tasks.md) for full task-by-task detail.

---

## P6 — Save Flow (Tag & Export)

The end of the user journey: take the compiled metadata + selected download file → write tags to the file → move it to the output directory.

This requires wiring together pieces that exist in isolation:

- `src/utils/metadata.ts` has FLAC tagging logic (using `flac-tagger` + `node-id3`)
- The compiled metadata from P4 needs to drive the tags written
- The user's chosen output directory (from settings, P7) determines where the file lands
- The "Include MusicBrainz tags" toggle (from settings) controls whether MB IDs are embedded
- After saving, the task transitions to a "saved" state with the on-disk path tracked, enabling the "previously saved" panel view

The **diff view** (P5) is part of this flow — shown when updating an already-saved file.

---

## P7 — Settings System ✅ Complete (T7.10 deferred)

Settings modal with keyboard navigation, search/filter, and persistence to disk. T7.1–T7.9 are implemented; T7.10 (auto-behavior hooks) is deferred.

**What's in place:**

- `src/settings/appSettings.ts` — `AppSettings` type (general: reopenLastSession, appDataDir, animationsEnabled) + `DEFAULT_APP_SETTINGS`
- `src/settings/settingsStore.ts` — `SettingsStore` singleton; atomic write (write-then-rename); app settings and per-flow settings stored together as `{ general: {...}, flows: { [flowId]: {...} } }`; `onSettingsChanged` EventEmitter for live reload
- `src/settings/buildSettingsItems.ts` — `SettingsItem` discriminated union, `isInteractive()`, `itemRowHeight()`, `filterSettingsItems()` (search filtering with ancestor-header preservation)
- `src/settings/buildGlobalSettingsItems.ts` — builds the global/app settings item list
- `src/base/providerSettings.ts` — `ProviderSettingsSchema` + `ProviderConstructorLike`; providers declare `static defaultSettings` for auto-generated settings UI
- `src/base/flow/flow-settings.ts` — `FlowSettings<T>` typed wrapper around `SettingsStore` for per-flow settings
- `src/flows/musicDownloadFlow/settings.ts` — `MusicDownloadFlowSettings` type (metadata + download with per-provider blobs); `extractProviderDefaults()` builds defaults from registered providers
- `src/flows/musicDownloadFlow/buildFlowSettingsItems.ts` — `buildFlowSettingsItems()` driven by registered provider constructors; reads `static defaultSettings` off each to auto-render provider cards
- `src/components/SettingsModal.tsx` — full-screen overlay; search bar (focused by default) with live `filterSettingsItems()`; scrollable item list with height-aware paging; draft state for app + flow settings; `Ctrl+S` writes both, `Esc` discards
- `src/components/SettingsItemRow.tsx` — per-kind renderer (sectionHeader, subHeader, providerHeader, checkbox, textInput, action)
- `src/flows/musicDownloadFlow/toolbar/useSettingsButton.ts` — opens modal via `switchWindow('settingsModal')`
- `src/flows/musicDownloadFlow/saveSettings.ts` — `getSaveSettings()` now reads from `SettingsStore` (no longer a hardcoded stub)
- `src/components/AppInner.tsx` — `<SettingsModal>` mounted alongside other modals
- `.gitignore` — `config/settings.json` excluded

**Architectural divergence from plan:**

The original plan had one flat `AppSettings` type covering general + metadata + download. The actual implementation splits into two tiers: a thin `AppSettings` (general only, global across flows) and `MusicDownloadFlowSettings` (metadata/download/providers, flow-scoped). The `ProviderSettingsSchema` mechanism is new — it lets each provider class self-describe its settings so the modal renders them automatically without any hardcoding in the UI.

**Known gaps vs. original plan:**

- T7.10 (auto-behavior hooks: auto-fetch, auto-save, auto-delete, auto-relocate) is not implemented
- Provider enable/disable does not yet rebuild the service registry dynamically — `onSettingsChanged` triggers `notifyTaskSubscribers()` for UI refresh only; the `enabled` flag in provider settings is rendered but not yet acted upon at runtime

See [p7/tasks.md](p7/tasks.md) for full task-by-task detail.

---

## P8 — Provider Display Registry ✅ Complete

**The extensibility problem.** Provider display metadata (labels, colors, acronyms) was hardcoded across 8 separate files in copy-pasted dictionaries. Adding a new provider required touching all of them.

**What's in place:**

- `src/base/providerDisplay.ts` — `ProviderDisplay` interface (label, acronym, color, colorSubtle, colorBright), `ProviderDisplayRegistry` class with a module-level `providerDisplayRegistry` singleton, `BUILTIN_PROVIDERS` covering all known platforms
- `ServiceRegistry.register()` accepts a class constructor — reads `static readonly display` off the class and auto-registers it in `providerDisplayRegistry`
- All 4 active service classes (`SpotifyService`, `YoutubeService`, `YtDlpService`, `SoulseekService`) declare `static readonly display`
- All 8 previously hardcoded locations now call `providerDisplayRegistry.get(key)` — no local dicts

Adding a new provider now requires only: a service class with `static display` + one `.register(MyService)` line in `MusicDownloadFlow`'s constructor.

See [p8/tasks.md](p8/tasks.md) for full task-by-task detail.

---

## P9 — Session Persistence

"Re-open last session on start-up" (visible in the settings screenshot). The task list, task states, metadata sources, download sources, and on-disk file paths should survive a restart.

This is separate from the API cache (which already works). It means serializing the full `tasks[]` array — including `MusicDownloadTaskAttributes` — to disk on exit and deserializing on startup. The on-disk path references inside `downloadSources` must remain valid across restarts, which ties into the "auto-relocate missing files" setting from P7.

---

## P9 — MusicBrainz Integration

The `MusicBrainzService` is fully implemented but commented out of the service registry. Enabling it is not just an uncomment — it requires:

- Wiring it into the active metadata registry (behind a settings toggle, P7)
- A `MbCell` column that shows real status (currently references the placeholder component)
- The "Use MusicBrainz links during discovering" setting controlling whether MB IDs are embedded in the compiled metadata
- `[Ctrl+M]` to open the currently selected file directly in MusicBrainz Picard (`open` package is already available)
- The "Include MusicBrainz tags" checkbox in the download preview panel (P5) persisted per-task

MusicBrainz has a strict 1 req/sec rate limit — the service already handles this, but it will become visible under load once it's active.

---

## Summary Table

| #   | Project                                   | Depends on | Blocks     |
| --- | ----------------------------------------- | ---------- | ---------- |
| P1  | Global Keyboard / Input System            | —          | P2, P4, P5 |
| P2  | Two-Panel Layout                          | P1         | P4, P5     |
| P3  | Import System                             | P1         | —          |
| P4  | Metadata Source Management Panel          | P1, P2     | P6         |
| P5  | Download Source Selection & Audio Preview | P1, P2     | P6         |
| P6  | Save Flow (Tag & Export)                  | P4, P5     | P8         |
| P7  | Settings System                           | P1, P2     | P9         |
| P8  | Session Persistence                       | P6, P7     | —          |
| P9  | MusicBrainz Integration                   | P7         | —          |
