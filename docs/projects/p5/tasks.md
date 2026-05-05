# P5 — Download Source Selection & Audio Preview Panel: Tasks

**Status: All tasks complete (T5.1–T5.9)**

## Context

**Current state of download data:**

`TrackDownloadSource` (in `types.ts`):

```typescript
type TrackDownloadSource = {
  state: "pending" | "searching" | "downloading" | "downloaded" | "failed";
  provider: "ytdlp" | "soulseek";
  track: TrackMetadata; // the metadata source used to find this download
  localFile?: LocalFile; // { state: 'found'|'not_found', path, name, extension, sourceUrl }
  downloadedAt: Date;
  selected: boolean; // exists but all sources are set to true — no exclusive selection
};
```

`YtDlpService.downloadTrack()` produces one `TrackDownloadSource` per run, saves FLAC to `DOWNLOAD_DIR`, sets `state: 'downloaded'` and `selected: true`. There is no file size, duration, or embedded tag info stored — only the file path.

`src/utils/metadata.ts` has `cleanAndTagFlac()` (using `flac-tagger` + `node-id3`) and `renameFile()`. These are standalone functions not yet called from any task flow.

`sound-play` is already a dependency. `play(path, volume)` returns a Promise that resolves when the file finishes playing. There is no pause/seek API — playback must be stopped by killing the OS process (platform-specific), so this implementation supports **play/stop only**, not true scrubbing. A future library swap can add scrubbing.

**What the UI currently shows:**

`YtDlpCell` reads `downloadSources.find(d => d.provider === 'ytdlp')` and displays the filename or state. There is no secondary panel, no source selection, no preview, and no saved-state tracking.

**Where P5 plugs in:**

P2/T2.9 creates the `SourcesPanel` scaffold with an inner left/right split. P4/T4.8 fills it for metadata mode. P5 fills it for download mode. P6 (Save Flow) is the downstream consumer — it reads the selected `TrackDownloadSource` and the compiled metadata from P4 to perform the actual save.

---

## Tasks

### T5.1 ✅ — Extend `TrackDownloadSource` with `fileInfo` and `savedFile`

Two new optional fields in `types.ts`:

```typescript
type FileInfo = {
  format: "flac" | "mp3" | "ogg";
  sizeBytes: number;
  durationMs: number;
  embeddedTags: Record<string, string | string[]>; // raw Vorbis Comment / ID3 tags
};

type SavedFile = {
  path: string; // final on-disk path (output directory, not temp)
  savedAt: Date;
};

type TrackDownloadSource = {
  // ... existing fields ...
  fileInfo?: FileInfo; // populated after download completes
  savedFile?: SavedFile; // populated after the user saves via P6
};
```

`fileInfo` is read from the FLAC file immediately after download and stored on the source so the detail panel can display it without re-reading the file on every render.

`savedFile` is written by the save flow (P6) — P5 only reads it.

Also added: `isRejected?: boolean` on `TrackDownloadSource` (used by T5.6).

_Depends on: nothing_

---

### T5.2 ✅ — Read `fileInfo` from the FLAC file after download

Extracted as a standalone utility at `src/flows/musicDownloadFlow/utils/readFileInfo.ts` (called from `YtDlpService.downloadTrack()`). Uses `fs/promises.stat` + `flac-tagger.readFlacTags()` as planned.

**Deviation:** `flac-tagger` does not expose `streamInfo` reliably, so `durationMs` is not computed from `totalSamples / sampleRate`. Instead, `readFileInfo` takes a `fallbackDurationMs: number` parameter (the track's `duration` field from metadata) and stores that. The `PlaybackBar` falls back to mpv's live `duration` property-change event once playback starts, so the displayed duration is still accurate.

_Depends on: T5.1_

---

### T5.3 ✅ — Build `DownloadSourceTree` component (left side of SourcesPanel in download mode)

Implemented at `src/components/SecondaryPanel/DownloadPanel/DownloadSourceTree/` (split into `index.tsx`, `ProviderHeader.tsx`, `MetadataHeader.tsx`, `SourceFileRow.tsx` sub-components).

Tree structure, state badges, `↑/↓` navigation skipping non-selectable rows, and provider colors via `SERVICE_DISPLAY_MAPPING` all match the spec.

**Addition:** `[Space]` in the tree also plays/pauses the selected file directly (not only from the detail pane), using the `MpvPlayer` singleton.

_Depends on: T5.1_

---

### T5.4 ✅ — Build `DownloadSourceDetail` component (right side of SourcesPanel in download mode)

Implemented at `src/components/SecondaryPanel/DownloadPanel/DownloadSourceDetail/` (`DownloadSourceDetail.tsx`, `DetailRow.tsx`, `DiffRow.tsx`, `DiffView.tsx`). Layout, tag sections, file-not-found state, and the "Saved" section all match the spec.

_Depends on: T5.1_

---

### T5.5 ✅ — Audio playback with `[Space]`

`sound-play` was not used. Playback is handled by `MpvPlayer` (see [play-music-audit.md](play-music-audit.md#what-was-actually-built)) — a custom direct-IPC mpv client that provides real pause/resume and seek, not just play/stop.

**Controls (in `DownloadSourceDetail` when detail pane is active):**
- `[Space]` — play if stopped, toggle pause/resume if already playing
- `[Shift+←]` / `[Shift+→]` — seek −5 s / +5 s (added beyond original spec)

`DownloadSourceDetail` subscribes to `MpvPlayer` `progress` and `stateChange` events via `useEffect` (not `setInterval`) and passes live `positionMs`/`durationMs` to `PlaybackBar`. The `▶`/`⏸` icon, block-character fill, and `position / duration` timestamps all work as specced.

_Depends on: T5.1, T5.4_

---

### T5.6 ✅ — Exclusive source selection

Currently every `TrackDownloadSource` is created with `selected: true`, and no code enforces at-most-one. The UI for P5 requires exactly one selected source at a time (the one that will be saved).

Add a helper to `DownloadTask`:

```typescript
selectDownloadSource(index: number): void {
  const sources = this.getAttributes()?.downloadSources ?? [];
  this.updateAttributes({
    downloadSources: sources.map((s, i) => ({ ...s, selected: i === index })),
  });
}
```

In `DownloadSourceTree`, pressing `[Enter]` on a file row calls `task.selectDownloadSource(index)`. The `☛` indicator and the right-side detail panel both follow the `selected` flag.

On task creation (in `startDownloads()`), only the first successfully downloaded source should be auto-selected; subsequent ones start with `selected: false`.

Also added on `DownloadTask`: `rejectDownloadSource(index, rejected)` (toggles `isRejected`, clears `selected` when rejecting) and `updateLocalFile(sourceIndex, newPath)` (used by T5.8).

_Depends on: T5.1, T5.3_

---

### T5.7 ✅ — Diff view when changing an already-saved source

When a task has at least one source with `savedFile` set and the user selects a **different** source (via `[Enter]` in the source tree), instead of immediately calling `selectDownloadSource()`, enter diff mode in the detail panel.

**Diff mode layout** — replaces the normal detail view:

```
  ── Current (saved) ─────────┬── New ──────────────────
  File  P_Biscuit_Sunset.flac │ P_Biscuit_-_Sunset.flac
  Size  4.2 MB                │ 8.1 MB                ← changed
  TITLE Sunset Lover          │ Sunset Lover
  ARTIST Petit Biscuit        │ Petit Biscuit
  ALBUM Presence              │ Presence
  DATE  2017                  │ 2017
  ...
```

Changed fields are highlighted (e.g. yellow). Unchanged fields are dim.

**Controls in diff mode:**

- `[Enter]` → confirm: call `selectDownloadSource(newIndex)` and exit diff mode (the actual file save happens via P6's action)
- `[Esc]` → cancel: do not change selection, exit diff mode

Diff mode is tracked as local state in `DownloadSourceDetail` (`isDiffMode: boolean`, `pendingSourceIndex: number | null`). It is entered from the tree (T5.6) when a source is selected while a saved source exists.

_Depends on: T5.4, T5.6_

---

### T5.8 ✅ — `[Ctrl+F]` file relocation

When `source.localFile?.state === 'not_found'` and the user presses `[Ctrl+F]` (while the detail panel is active):

1. Open a `TaskPrompt` of type `PromptType.Input` asking: `"Enter new file path for: <filename>"`
2. The user types a path and submits
3. Validate: `fs.existsSync(newPath)` — if not found, show an error and re-prompt (by rejecting the prompt with a message and re-opening)
4. On valid path: call `task.updateAttributes()` to update `localFile.path` and `localFile.state = 'found'` on the matching `TrackDownloadSource`

The `TaskPrompt` mechanism already exists (`PromptModal` renders it). This just needs to open a prompt from the detail panel's key handler and handle the resolved value.

Register `Ctrl+F` in the key handler for `'downloadSourceDetail'` (via P1/T1.5 modifier support). Until P1 is done, use a local `useInput`.

Uses `typedTask.getPrompt().askInput()` for the path input. Path validation (`fs.existsSync`) and the `updateLocalFile()` call on `DownloadTask` match the spec.

_Depends on: T5.1, T5.4, P1/T1.5_

---

### T5.9 ✅ — Wire `SourcesPanel` to download components

Implemented as a dedicated `DownloadPanel` component (`src/components/SecondaryPanel/DownloadPanel/DownloadPanel.tsx`) rather than extending `SourcesPanel`. `SecondaryPanel` mounts it when `primaryMode === 'download'` alongside the existing `MetadataPanel` for `primaryMode === 'metadata'`. Focus management and `innerFocus` switching (`→`/`←` between list and detail) use `useFocusContext` as planned.

`Shift+←/→` resizes the left/right split ratio (only when the list pane is focused; the detail pane uses those keys for seek).

_Depends on: T5.3, T5.4, T5.5, T5.6, T5.7, T5.8, P2/T2.9, P1/T1.2_

---

## Summary

| Task | What                                                                    | Depends on                   | Status |
| ---- | ----------------------------------------------------------------------- | ---------------------------- | ------ |
| T5.1 | Add `fileInfo` and `savedFile` to `TrackDownloadSource`                 | —                            | ✅     |
| T5.2 | Populate `fileInfo` from FLAC file after download in `YtDlpService`     | T5.1                         | ✅     |
| T5.3 | `DownloadSourceTree` — grouped tree with state badges                   | T5.1                         | ✅     |
| T5.4 | `DownloadSourceDetail` — file info, embedded tags, saved/missing states | T5.1                         | ✅     |
| T5.5 | Audio playback with `[Space]`, seek `[Shift+←/→]`, live progress bar   | T5.1, T5.4                   | ✅     |
| T5.6 | Exclusive source selection via `[Enter]` in the tree                    | T5.1, T5.3                   | ✅     |
| T5.7 | Diff view when switching source after a file is already saved           | T5.4, T5.6                   | ✅     |
| T5.8 | `[Ctrl+F]` file relocation via `TaskPrompt`                             | T5.1, T5.4, P1/T1.5          | ✅     |
| T5.9 | Wire `DownloadPanel` into `SecondaryPanel` + focus state                | T5.3–T5.8, P2/T2.9, P1/T1.2 | ✅     |
