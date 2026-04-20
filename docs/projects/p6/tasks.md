# P6 — Save Flow (Tag & Export): Tasks

## Context

**What the save flow does:**

The user selects a download source in the download panel (P5), presses `[Enter]`, and the app:

1. Copies the downloaded FLAC from `DOWNLOAD_DIR` to the output directory with a clean filename
2. Writes compiled metadata tags (from P4's `CompiledMetadata`) to the copy
3. Updates the task's `TrackDownloadSource.savedFile` (introduced in P5/T5.1)
4. Transitions the task to a "saved" visual state

The copy-then-tag order (not tag-then-move) keeps the temp file in `DOWNLOAD_DIR` unmodified, so the user can re-save with different settings without re-downloading.

**Existing pieces and their problems:**

`src/utils/metadata.ts` — `cleanAndTagFlac(filePath, metadata)`:
- **Broken import**: `import logger from './logger'` — no such file exists in `src/utils/`. The function body references `globalLogger` (not the imported `logger`), so `globalLogger` is undefined at runtime and would crash.
- **Incomplete `Metadata` type**: only covers `trackTitle`, `artistName`, `albumName`, `trackNumber`, `year`. Missing: `albumArtists`, `isrc`, `genres`, `bpm`, `key`, MusicBrainz IDs.
- Works correctly for the tagging logic itself once the bugs are fixed.

`src/utils/metadata.ts` — `renameFile(oldPath, newPath)`:
- Explicitly **rejects cross-directory moves** (throws if `oldDir !== newDir`). The save flow must move across directories (`DOWNLOAD_DIR` → output dir), so this function cannot be used as-is.

**Settings dependency:**

Two save options come from P7 (Settings System), which isn't built yet:
- **Output directory** — where to move the tagged file (default: `~/Music`)
- **Include MusicBrainz tags** — whether to embed MB IDs in the Vorbis Comments

P6 defines a `SaveSettings` interface and provides safe defaults. P7 will replace the defaults with its real persistence layer.

---

## Tasks

### T6.1 — Fix `src/utils/metadata.ts`

Three independent fixes to make the file usable:

**Fix 1 — Broken logger import:**

```typescript
// remove:
import logger from './logger';

// add:
import { globalLogger } from '../base/logger/logger';
```

All `globalLogger.info/error/warn` calls in the file already reference `globalLogger` by name — they just need the import to actually exist.

**Fix 2 — Expand the `Metadata` type:**

```typescript
type Metadata = {
  trackTitle: string;
  artists: string[];          // replaces single artistName
  albumArtists?: string[];
  albumName?: string;
  year?: string;
  trackNumber?: string;
  isrc?: string;
  genres?: string[];
  bpm?: number;
  key?: string;
  musicBrainzTrackId?: string;
  musicBrainzAlbumId?: string;
  musicBrainzArtistId?: string;
  musicBrainzReleaseGroupId?: string;
};
```

Update the `FlacTagMap` construction in `cleanAndTagFlac()` to write all fields:

```typescript
const newTags: FlacTagMap = {
  ...currentTags.tagMap,
  TITLE: metadata.trackTitle,
  ARTIST: metadata.artists,
  ALBUMARTIST: metadata.albumArtists ?? metadata.artists,
  ...(metadata.albumName    ? { ALBUM: metadata.albumName }           : {}),
  ...(metadata.year         ? { YEAR: metadata.year, DATE: metadata.year } : {}),
  ...(metadata.trackNumber  ? { TRACKNUMBER: metadata.trackNumber }   : {}),
  ...(metadata.isrc         ? { ISRC: metadata.isrc }                 : {}),
  ...(metadata.genres?.length ? { GENRE: metadata.genres }            : {}),
  ...(metadata.bpm != null  ? { BPM: String(metadata.bpm) }          : {}),
  ...(metadata.key          ? { KEY: metadata.key }                   : {}),
  ...(metadata.musicBrainzTrackId        ? { MUSICBRAINZ_TRACKID:        metadata.musicBrainzTrackId }        : {}),
  ...(metadata.musicBrainzAlbumId        ? { MUSICBRAINZ_ALBUMID:        metadata.musicBrainzAlbumId }        : {}),
  ...(metadata.musicBrainzArtistId       ? { MUSICBRAINZ_ARTISTID:       metadata.musicBrainzArtistId }       : {}),
  ...(metadata.musicBrainzReleaseGroupId ? { MUSICBRAINZ_RELEASEGROUPID: metadata.musicBrainzReleaseGroupId } : {}),
};
```

**Fix 3 — Replace `renameFile()` with `moveFile()`:**

`renameFile()` rejects cross-directory moves. Replace it entirely:

```typescript
export async function moveFile(srcPath: string, destPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  try {
    await fs.promises.rename(srcPath, destPath);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      // Cross-device / cross-partition: fall back to copy + delete
      await fs.promises.copyFile(srcPath, destPath);
      await fs.promises.unlink(srcPath);
    } else {
      throw err;
    }
  }
}
```

`fs.rename` is atomic on the same filesystem. `EXDEV` (cross-device link) is the error code when source and destination are on different partitions, triggering the copy+delete fallback.

*Depends on: nothing*

---

### T6.2 — Build `compiledMetadataToTags(compiled, options)`

Create `src/flows/musicDownloadFlow/utils/compiledMetadataToTags.ts`.

Converts a `CompiledMetadata` (from P4/T4.3) to the `Metadata` type expected by `cleanAndTagFlac()`:

```typescript
import { CompiledMetadata } from './compiledMetadata';
import { Metadata } from '../../../utils/metadata';

export interface TagOptions {
  includeMusicBrainzTags: boolean;
}

export function compiledMetadataToTags(
  compiled: CompiledMetadata,
  options: TagOptions,
): Metadata {
  return {
    trackTitle: compiled.trackName,
    artists: compiled.artists.map(a => a.name),
    albumArtists: compiled.album?.artists?.map(a => a.name),
    albumName: compiled.album?.albumName,
    year: compiled.year != null ? String(compiled.year) : undefined,
    trackNumber: compiled.trackNumber != null ? String(compiled.trackNumber) : undefined,
    isrc: compiled.isrc,
    genres: compiled.genres,
    bpm: compiled.bpm,
    key: compiled.key,
    ...(options.includeMusicBrainzTags ? {
      musicBrainzTrackId:        compiled.musicBrainzIds?.recording,
      musicBrainzAlbumId:        compiled.musicBrainzIds?.release,
      musicBrainzArtistId:       compiled.musicBrainzIds?.artist,
      musicBrainzReleaseGroupId: compiled.musicBrainzIds?.releaseGroup,
    } : {}),
  };
}
```

This is a pure function — no I/O, easily testable.

*Depends on: T6.1, P4/T4.3*

---

### T6.3 — Build `computeOutputPath(compiled, outputDir)`

Create `src/flows/musicDownloadFlow/utils/computeOutputPath.ts`.

Derives the final destination filename from compiled metadata and the output directory:

```typescript
export function computeOutputPath(
  compiled: CompiledMetadata,
  outputDir: string,
): string {
  const artist = compiled.artists[0]?.name ?? 'Unknown Artist';
  const title  = compiled.trackName || 'Unknown Title';
  const raw    = `${artist} - ${title}.flac`;
  const safe   = raw.replace(/[/\\:*?"<>|]/g, '_');
  return path.join(outputDir, safe);
}
```

**Collision handling:** if the computed path already exists on disk, append a counter:

```typescript
let dest = basePath;
let counter = 2;
while (fs.existsSync(dest)) {
  const ext  = path.extname(basePath);
  const base = path.basename(basePath, ext);
  dest = path.join(outputDir, `${base} (${counter})${ext}`);
  counter++;
}
return dest;
```

*Depends on: P4/T4.3*

---

### T6.4 — Define `SaveSettings` interface and defaults

Create `src/flows/musicDownloadFlow/saveSettings.ts`. P7 will fill this with real persistence; P6 calls it through this interface so the coupling is one-directional:

```typescript
export interface SaveSettings {
  outputDir: string;
  includeMusicBrainzTags: boolean;
}

export function getDefaultSaveSettings(): SaveSettings {
  return {
    outputDir: process.env.OUTPUT_DIR
      ?? path.join(os.homedir(), 'Music'),
    includeMusicBrainzTags: false,
  };
}

// P7 will replace this with a real reader:
export function getSaveSettings(): SaveSettings {
  return getDefaultSaveSettings();
}
```

All save-flow code calls `getSaveSettings()` — never `getDefaultSaveSettings()` directly. When P7 lands, only `getSaveSettings()` needs to change.

*Depends on: nothing*

---

### T6.5 — Build `saveTrack()` method on `DownloadTask`

The main orchestration method. Add to `DownloadTask`:

```typescript
async saveTrack(): Promise<void>
```

It reads settings internally via `getSaveSettings()` so callers need no arguments:

**Steps:**

1. **Get the selected source** — `downloadSources.find(s => s.selected)`. Throw if none selected or if `localFile?.state !== 'found'`.

2. **Check for existing saved file** — if `selectedSource.savedFile` exists, this is an update; the old file at `savedFile.path` must be deleted first (see T6.7 for the confirmed-diff trigger; by the time `saveTrack()` is called, the diff has already been confirmed).

3. **Compute compiled metadata** — call `computeCompiledMetadata(metadataSources, metadataOverrides)` (P4/T4.3).

4. **Convert to tags** — call `compiledMetadataToTags(compiled, { includeMusicBrainzTags })`.

5. **Compute output path** — call `computeOutputPath(compiled, settings.outputDir)`.

6. **Copy temp file to output path:**

```typescript
await fs.promises.copyFile(localFile.path, outputPath);
```

7. **Tag the output copy** — call `cleanAndTagFlac(outputPath, tags)`.

8. **Update task attributes:**

```typescript
this.updateAttributes({
  downloadSources: sources.map(s =>
    s === selectedSource
      ? { ...s, savedFile: { path: outputPath, savedAt: new Date() } }
      : s
  ),
});
```

9. **Update task status** to `StatusType.Success` with message `"Saved"`.

Wrap steps 6–9 in try/catch. On failure, delete the partial output file if it was created (`fs.unlink` with ignore-on-missing), set task status to `Error`, and rethrow.

*Depends on: T6.1, T6.2, T6.3, T6.4, P4/T4.3, P5/T5.1*

---

### T6.6 — Wire `[Enter]` in the download panel to `saveTrack()`

In the contextual action bar for `'downloadSourceDetail'` (registered in P5/T5.9), add the save action:

```typescript
{
  shortcuts: [{ key: 'return' }],
  label: selectedSource?.savedFile ? 'Update' : 'Save',
  description: 'Tag and save to output directory',
  onClick: () => task.saveTrack(),
}
```

The label switches between "Save" (first-time) and "Update" (re-save over an existing saved file) based on whether `savedFile` is set.

**Disabled states** — hide or dim the action when:
- No source is selected (`selectedSource === null`)
- Selected source's `localFile.state === 'not_found'` (offer `[Ctrl+F]` relocate instead)
- `saveTrack()` is already running (prevent double-trigger; check task status `=== Processing`)

Register `[Enter]` through the centralized dispatcher (P1/T1.4) under `'downloadSourceDetail'`. Until P1 is done, use a local `useInput`.

*Depends on: T6.5, P5/T5.9*

---

### T6.7 — Handle re-save over an existing saved file

When `saveTrack()` is called and `selectedSource.savedFile` already exists (the task was previously saved), the old output file must be deleted before writing the new one:

```typescript
if (selectedSource.savedFile) {
  try {
    await fs.promises.unlink(selectedSource.savedFile.path);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err; // ignore if already gone
  }
}
```

This is the point after the diff view (P5/T5.7) has been confirmed. The call sequence is:

1. User selects a different source → P5/T5.7 shows diff view
2. User confirms with `[Enter]` in diff view → `task.selectDownloadSource(newIndex)` is called
3. User presses `[Enter]` in detail panel → `task.saveTrack()` is called
4. `saveTrack()` detects `savedFile` on the now-selected source and deletes the old file

The diff confirmation (step 2) and the save trigger (step 3) are separate actions. This avoids a single `[Enter]` press both confirming the diff AND immediately saving — the user sees the new source is selected and can review before pressing save.

*Depends on: T6.5, P5/T5.7*

---

### T6.8 — Update `YtDlpCell` to reflect saved state

`YtDlpCell` currently shows the filename or `downloadSource.state` string. After P6, the definitive saved state lives in `savedFile`. Update the cell:

```typescript
const saved = downloadSource?.savedFile;
const display = saved
  ? path.basename(saved.path)          // show final filename
  : downloadSource?.localFile?.name
  ?? downloadSource?.state
  ?? '';

const color = saved
  ? 'cyan'
  : downloadSource?.state === 'downloaded' ? 'green' : 'white';
```

This gives the task table a clear visual indicator: cyan = saved, green = downloaded but not yet saved, white = in progress.

*Depends on: T6.5, P5/T5.1*

---

## Summary

| Task | What | Depends on |
|------|------|-----------|
| T6.1 | Fix broken import, expand `Metadata` type, replace `renameFile` with `moveFile` | — |
| T6.2 | `compiledMetadataToTags()` — `CompiledMetadata` → `Metadata` mapping | T6.1, P4/T4.3 |
| T6.3 | `computeOutputPath()` — sanitised filename + collision handling | P4/T4.3 |
| T6.4 | `SaveSettings` interface + `getSaveSettings()` stub for P7 | — |
| T6.5 | `saveTrack()` on `DownloadTask` — copy, tag, move, update state | T6.1–T6.4, P4/T4.3, P5/T5.1 |
| T6.6 | Wire `[Enter]` in download detail panel to `saveTrack()` | T6.5, P5/T5.9 |
| T6.7 | Handle re-save: delete old output file before writing new one | T6.5, P5/T5.7 |
| T6.8 | Update `YtDlpCell` to show saved state in cyan | T6.5, P5/T5.1 |
