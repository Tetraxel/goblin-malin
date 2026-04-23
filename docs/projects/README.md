# Projects

High-level technical projects needed to reach the target product described in the [root README](../../README.md) and [design screenshots](../designs/).

These are not task lists — each project is a self-contained scope of work. Individual tasks are broken out in each project's subfolder.

| Project | Tasks |
|---------|-------|
| P1 — Global Keyboard / Input System | [p1/tasks.md](p1/tasks.md) |
| P2 — Two-Panel Layout | [p2/tasks.md](p2/tasks.md) |
| P3 — Import System | [p3/tasks.md](p3/tasks.md) |
| P4 — Metadata Source Management Panel | [p4/tasks.md](p4/tasks.md) |
| P5 — Download Source Selection & Audio Preview | [p5/tasks.md](p5/tasks.md) |
| P6 — Save Flow (Tag & Export) | [p6/tasks.md](p6/tasks.md) |
| P7 — Settings System | [p7/tasks.md](p7/tasks.md) |

---

## P1 — Global Keyboard / Input System

**The biggest architectural risk.** The target UI has deeply context-sensitive keyboard shortcuts: the same key does a different thing depending on which panel is focused, which row is selected, and which column is active. The current approach — multiple `useInput` hooks scattered across components — already shows strain (`setMaxListeners(30)` in `App.tsx`). It will break down completely once the secondary panel, metadata source list, and download tree all need their own shortcuts simultaneously.

What's needed is a single centralized input router that:
- Knows the current "focus context" (active window + selection within it)
- Dispatches key events to the right handler without components fighting over them
- Renders the correct contextual action bar at the bottom from that context
- Supports **multi-select**: users can select multiple tasks simultaneously (e.g., `Space` to toggle, `Ctrl+A` to select all); contextual actions that are invalid for a multi-selection are hidden, and batch-only actions appear when multiple tasks are selected

This project touches almost every other project below, so it should be resolved or at least designed early. The existing `FocusContext` is a foundation but stops short of action dispatch.

---

## P2 — Two-Panel Layout ✅ Largely complete

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

## P3 — Import System

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

## P4 — Metadata Source Management Panel

The secondary panel in metadata mode shows the full picture for the selected task:

- A **ranked list of discovered metadata sources** (Spotify, YouTube, MusicBrainz, Soulseek, etc.) with platform badges, track name, and duration
- Each source can be **favorited** `[F]`, **rejected** `[Del]`, and **reordered** `[Shift+↑/↓]`
- A **"Compiled Metadata" row** at the top — a virtual aggregate that picks each field from the highest-ranked non-rejected source
- The compiled row is the only editable one — the user can override individual fields
- A full metadata field display: Title, Artists, Duration, ISRC, Album, Year, Track#, BPM, Key, Genres, MusicBrainz IDs

The current data model (`metadataSources: TrackMetadata[]`) exists but has no ranking, favorite, or rejected state. That needs to be added to `MusicDownloadTaskAttributes`. The compiled metadata concept is new — it needs to be computed (not stored) from the ranked, non-rejected sources, with manual overrides layered on top.

---

## P5 — Download Source Selection & Audio Preview Panel

The secondary panel in download mode shows:

- A **download source tree** grouped by provider (YtDlp, Soulseek), then by the metadata source used, then individual downloaded files with filename, size, and state (DOWNLOADED / SAVED / failed)
- The selected file previewed in the right sub-panel: format, size, duration, all embedded tags
- An **audio scrubber** with `[Space]` to play/pause (the `sound-play` dependency is already there but unused beyond the startup sound)
- A `[Enter]` / `Update` action to save/tag the selected file
- When the on-disk file is missing: a "Lost the link to the file" warning + `[Ctrl+F]` to relocate
- When changing the download source after a file is already saved: a **side-by-side diff view** (old version left, new version right) before confirming the update

Currently `downloadSources` is populated but there is no selection UI and no secondary panel for it at all.

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

## P7 — Settings System

A full settings modal (opened from the toolbar) with keyboard navigation and persistence to disk:

**General:**
- Re-open last session on start-up

**Metadata:**
- Auto-fetch primary metadata on import
- Auto-choose best metadata source
- Toggle visible columns (URL, Artist, Track title)
- Per-provider cards: Spotify, Deezer, Apple Music, Tidal, YouTube, SoundCloud, MusicBrainz — each with an Enable toggle and provider-specific options
- MusicBrainz extras: Import file in Picard on save, Include MB metadata in tags by default, Use MB links during discovering

**Download:**
- Auto-choose best download source
- Auto-save to output directory
- Auto-delete temporary downloads after 24h
- Auto-relocate missing files
- Set default output directory (text input)
- Clear download cache action
- Toggle visible columns
- Per-provider cards: YtDlp (enable + auto-download latest binary), Soulseek (enable + auto-download)

Settings need to persist to disk (JSON file) and be read by services at runtime — i.e., the service registries in `MusicDownloadFlow` need to become dynamic based on settings (enabled providers).

---

## P8 — Session Persistence

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

| # | Project | Depends on | Blocks |
|---|---------|-----------|--------|
| P1 | Global Keyboard / Input System | — | P2, P4, P5 |
| P2 | Two-Panel Layout | P1 | P4, P5 |
| P3 | Import System | P1 | — |
| P4 | Metadata Source Management Panel | P1, P2 | P6 |
| P5 | Download Source Selection & Audio Preview | P1, P2 | P6 |
| P6 | Save Flow (Tag & Export) | P4, P5 | P8 |
| P7 | Settings System | P1, P2 | P9 |
| P8 | Session Persistence | P6, P7 | — |
| P9 | MusicBrainz Integration | P7 | — |
