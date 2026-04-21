# P5 — Download Source Selection & Audio Preview Panel: Tasks

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

### T5.1 — Extend `TrackDownloadSource` with `fileInfo` and `savedFile`

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

_Depends on: nothing_

---

### T5.2 — Read `fileInfo` from the FLAC file after download

In `YtDlpService.downloadTrack()`, after the file is confirmed on disk (both the download case and the already-exists case), read file info and attach it to the returned `TrackDownloadSource`:

```typescript
import { stat } from "fs/promises";
import { readFlacTags } from "flac-tagger";

async function readFileInfo(filePath: string): Promise<FileInfo> {
  const [stats, flacData] = await Promise.all([
    stat(filePath),
    readFlacTags(filePath),
  ]);
  const durationMs = /* from flacData.streamInfo.totalSamples / sampleRate * 1000 */ 0;
  return {
    format: "flac",
    sizeBytes: stats.size,
    durationMs,
    embeddedTags: flacData.tagMap ?? {},
  };
}
```

`flac-tagger`'s `readFlacTags()` returns a `FlacTags` object with `tagMap` (the Vorbis Comments) and `streamInfo` (sample rate, channels, total samples). Duration = `streamInfo.totalSamples / streamInfo.sampleRate * 1000`.

Call `readFileInfo()` right before returning from `downloadTrack()` and set `downloadSource.fileInfo`. Wrap in try/catch — if reading fails, log a warning and leave `fileInfo` undefined (the UI degrades gracefully to showing `—` for those fields).

_Depends on: T5.1_

---

### T5.3 — Build `DownloadSourceTree` component (left side of SourcesPanel in download mode)

Create `src/components/DownloadSourceTree.tsx`.

**Props:**

```typescript
interface DownloadSourceTreeProps {
  sources: TrackDownloadSource[];
  selectedSourceIndex: number | null;
  isActive: boolean;
  width: number;
  height: number;
}
```

**Tree structure** — grouped by `provider`, then by `source.track.platform` within each provider:

```
  [YTDLP]
    YouTube Music · Petit Biscuit – Sunset Lover
  ☛   Petit_Biscuit_-_Sunset_Lover.flac   4.2 MB  ● SAVED
  [SOULSEEK]
    Spotify · Petit Biscuit – Sunset Lover
      Petit_Biscuit_Sunset_Lover.flac      8.1 MB    DOWNLOADED
```

- Provider rows (e.g. `[YTDLP]`) are section headers — not selectable, rendered bold with the `SERVICE_DISPLAY_MAPPING` color
- Metadata-source sub-headers show the platform badge and `track.trackName` — also not selectable
- File rows are selectable. Show: filename, file size (formatted as MB), state badge
- State badges: `DOWNLOADING` (yellow), `DOWNLOADED` (green), `● SAVED` (cyan with dot), `FAILED` (red)
- The currently selected source is indicated with `☛`; `↑/↓` navigation skips non-selectable rows

If a source has no `localFile` (state is `pending`, `searching`, or `failed`), show the state instead of a filename.

_Depends on: T5.1_

---

### T5.4 — Build `DownloadSourceDetail` component (right side of SourcesPanel in download mode)

Create `src/components/DownloadSourceDetail.tsx`.

**Props:**

```typescript
interface DownloadSourceDetailProps {
  source: TrackDownloadSource | null;
  isDiffMode: boolean;
  previousSource: TrackDownloadSource | null; // only used in diff mode
  isActive: boolean;
  width: number;
  height: number;
}
```

**Normal mode** (when `isDiffMode === false`):

```
  File        Petit_Biscuit_-_Sunset_Lover.flac
  Format      FLAC
  Size        4.2 MB
  Duration    3:44

  ── Embedded Tags ──────────────────────────
  TITLE       Sunset Lover
  ARTIST      Petit Biscuit
  ALBUM       Presence
  DATE        2017
  TRACKNUMBER 1
  ...

  ── Saved ──────────────────────────────────
  Path        ~/Music/Petit Biscuit - Sunset Lover.flac
  Saved       2026-04-21 14:32
```

If `source.localFile?.state === 'not_found'`:

```
  ⚠ File not found
  Last known path: /tmp/downloads/Petit_Biscuit_-_Sunset_Lover.flac

  [Ctrl+F] Relocate file
```

If `source` is null (nothing selected): render a dim placeholder.

**Diff mode** — see T5.7.

_Depends on: T5.1_

---

### T5.5 — Audio playback with `[Space]`

When the source list is focused and the selected source has a `localFile.state === 'found'`:

- **`[Space]`** → start playing / stop playing
- While playing: show a progress bar (elapsed / total duration) updated every second via `setInterval`

**Playback implementation** using `sound-play`:

```typescript
import soundPlay from "sound-play";

// playing state (local to DownloadSourceDetail or a parent hook)
let stopPlayback: (() => void) | null = null;

function play(filePath: string, durationMs: number) {
  const startTime = Date.now();
  const promise = soundPlay.play(filePath, 1.0);
  // timer for progress
  const interval = setInterval(() => {
    setElapsedMs(Date.now() - startTime);
  }, 500);
  promise.finally(() => {
    clearInterval(interval);
    setElapsedMs(0);
    setIsPlaying(false);
  });
  stopPlayback = () => {
    clearInterval(interval);
    // sound-play has no stop API — kill the process on the platform level
    // On Windows: taskkill /F /IM powershell.exe (too broad)
    // Practical approach: just let it finish; mark as stopped in state
    setIsPlaying(false);
    stopPlayback = null;
  };
  setIsPlaying(true);
}
```

Note the limitation: `sound-play` spawns an OS process and does not expose a handle to kill it. Pressing `[Space]` again marks the UI as stopped but audio may continue briefly in the background. Document this as a known limitation — a future swap to a library with a proper stop API (e.g., `node-mpv`, `@discordjs/voice`, or a native addon) will fix it.

Progress bar in `DownloadSourceDetail`:

```
  ▶  ████████░░░░░░░░░░░░  1:23 / 3:44
```

Rendered as a `<Text>` using block characters. Width calculated from `fileInfo.durationMs` and `elapsedMs`.

_Depends on: T5.1, T5.4_

---

### T5.6 — Exclusive source selection

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

_Depends on: T5.1, T5.3_

---

### T5.7 — Diff view when changing an already-saved source

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

### T5.8 — `[Ctrl+F]` file relocation

When `source.localFile?.state === 'not_found'` and the user presses `[Ctrl+F]` (while the detail panel is active):

1. Open a `TaskPrompt` of type `PromptType.Input` asking: `"Enter new file path for: <filename>"`
2. The user types a path and submits
3. Validate: `fs.existsSync(newPath)` — if not found, show an error and re-prompt (by rejecting the prompt with a message and re-opening)
4. On valid path: call `task.updateAttributes()` to update `localFile.path` and `localFile.state = 'found'` on the matching `TrackDownloadSource`

The `TaskPrompt` mechanism already exists (`PromptModal` renders it). This just needs to open a prompt from the detail panel's key handler and handle the resolved value.

Register `Ctrl+F` in the key handler for `'downloadSourceDetail'` (via P1/T1.5 modifier support). Until P1 is done, use a local `useInput`.

_Depends on: T5.1, T5.4, P1/T1.5_

---

### T5.9 — Wire `SourcesPanel` to download components

Connect the `SourcesPanel` scaffold (P2/T2.9) to `DownloadSourceTree` + `DownloadSourceDetail` when `mode === 'download'` (parallel to P4/T4.8 which does the same for metadata mode):

```typescript
// inside SourcesPanel when mode === 'download':
const sources = selectedTask?.getAttributes()?.downloadSources ?? [];
const selected = sources.find(s => s.selected) ?? null;

<Box flexDirection="row">
  <DownloadSourceTree
    sources={sources}
    selectedSourceIndex={focusState.secondaryPanel.sourcesPanel.selectedSourceIndex}
    isActive={focusState.secondaryPanel.sourcesPanel.innerFocus === 'list'}
    width={leftWidth}
    height={height}
  />
  <DownloadSourceDetail
    source={selected}
    isDiffMode={isDiffMode}
    previousSource={previousSource}
    isActive={focusState.secondaryPanel.sourcesPanel.innerFocus === 'detail'}
    width={rightWidth}
    height={height}
  />
</Box>
```

Register `'downloadSourceTree'` and `'downloadSourceDetail'` as the active focus sub-windows when the secondary panel is in download mode. `Tab` (or `→`/`←`) switches `innerFocus` between them.

Add the contextual action bar entries for download mode: `[Space] Play`, `[Enter] Select`, `[Ctrl+F] Relocate` (the last one only when file is missing).

_Depends on: T5.3, T5.4, T5.5, T5.6, T5.7, T5.8, P2/T2.9, P1/T1.2_

---

## Summary

| Task | What                                                                    | Depends on                  |
| ---- | ----------------------------------------------------------------------- | --------------------------- |
| T5.1 | Add `fileInfo` and `savedFile` to `TrackDownloadSource`                 | —                           |
| T5.2 | Populate `fileInfo` from FLAC file after download in `YtDlpService`     | T5.1                        |
| T5.3 | `DownloadSourceTree` — grouped tree with state badges                   | T5.1                        |
| T5.4 | `DownloadSourceDetail` — file info, embedded tags, saved/missing states | T5.1                        |
| T5.5 | Audio playback with `[Space]`, timer-based progress bar                 | T5.1, T5.4                  |
| T5.6 | Exclusive source selection via `[Enter]` in the tree                    | T5.1, T5.3                  |
| T5.7 | Diff view when switching source after a file is already saved           | T5.4, T5.6                  |
| T5.8 | `[Ctrl+F]` file relocation via `TaskPrompt`                             | T5.1, T5.4, P1/T1.5         |
| T5.9 | Wire `SourcesPanel` to download components + focus state                | T5.3–T5.8, P2/T2.9, P1/T1.2 |
