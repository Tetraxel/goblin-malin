# P23 — Music Library & Duplicate Detection: Tasks

## Context

**The app forgets everything it saves.** `saveTrack()` ([downloadTask.ts](../../../src/flows/musicDownloadFlow/utils/downloadTask.ts):732) writes `savedFile` onto the task's download source — state that lives only inside that task, inside that session. Consequences for a real user with a growing collection:

- Re-importing a track (same URL, or same song from a different platform) silently re-fetches and re-downloads it. With P21 (playlist import) this becomes acute: re-importing an updated playlist re-downloads the 90 % you already have.
- There is no answer to "have I already saved this?" or "where did it go on disk?" without grepping folders.
- The target README promises **auto-relocation of missing files**; TODO.md wants **"Open all tracks in MB Picard"** — both need a persistent index to operate on.

Sessions are not a library: sessions are *working batches* (P13); a library is the *cumulative output*. This project adds the missing index — deliberately small (a store, a hook, a dedupe check, a modal), not a media-manager rewrite.

---

## Tasks

### T23.1 — Library store

`src/library/libraryStore.ts` + `types.ts`, persisted at `DEFAULT_APP_DATA_DIR/library.json` using the **same async, coalesced, atomic-rename write pattern** P20/F4 gave [sessionStore.ts](../../../src/sessions/sessionStore.ts) (no new persistence idioms):

```typescript
interface LibraryEntry {
    id: string;                  // uuid
    isrc?: string;               // primary dedupe key when present
    uri?: string;                // TrackUriParts of the primary source
    artists: string[];
    title: string;
    album?: string;
    filePath: string;            // final on-disk path
    format: string;              // "flac" | "mp3" …
    provenance?: string;         // from P22/T22.5 when available
    sourceProvider: string;      // "ytdlp" | "soulseek"
    savedAt: string;             // ISO
    fileMissing?: boolean;       // set lazily by T23.4, never blocks
}
```

Lookup API: `findByIsrc(isrc)`, `findByUri(uri)`, `findByNormalizedTitle(artists, title)` (lowercase, strip punctuation/feat., collapse whitespace — one shared `normalizeTrackKey()` util with tests). In-memory `Map` indexes built at load; O(1) checks at import time.

_Depends on: nothing_

---

### T23.2 — Write hook in `saveTrack()`

- After a successful save, upsert a `LibraryEntry` (key preference: ISRC → URI → normalized artist+title) from the compiled metadata + saved path.
- Re-save/update (the existing old-file-delete path in `saveTrack`) updates the entry's `filePath`/`savedAt` instead of duplicating.
- The flow stays generic: the hook lives in the music flow's `saveTrack`, the store is flow-agnostic (other future flows can index their own outputs).

_Depends on: T23.1_

---

### T23.3 — Duplicate detection at import & in the task list

- **Import modal**: each detected URL row checks the library (URI match at detect time; ISRC match can only fire post-fetch). Matched rows show `✓ in library — saved 2026-05-01` and default to *import anyway* with a `[Space]`-toggleable "skip duplicates" batch switch in the modal footer.
- **Task list**: after primary metadata fetch, tasks whose ISRC/normalized key hits the library get a subtle `◆ saved` indicator next to the status and a contextual action "Open saved file location". This catches the cross-platform duplicate (Spotify import of a track previously saved from YouTube) that URL matching can't.

_Depends on: T23.1, T23.2_

---

### T23.4 — Missing files & relocation

- Lazy verification: when the library modal opens (or a saved-badge is rendered), `stat` the path off the main thread and set `fileMissing` — never blocks rendering.
- The existing `[Ctrl+F]` relocate flow (P5/T5.8) also updates the matching library entry.
- **Auto-relocation** (target-README feature): a library action that scans the configured output directory (and one level down) for a file whose tags/filename match the entry, offering the found path for confirmation. Reuses `readFileInfo` for tag matching.

_Depends on: T23.1, T23.2_

---

### T23.5 — Library modal

Toolbar button (`useLibraryButton`, same pattern as [useSessionsButton.ts](../../../src/components/Toolbar/useSessionsButton.ts)) opening a searchable modal modeled on [SessionsModal](../../../src/components/SessionsModal/SessionsModal.tsx) / [sessionSearch.ts](../../../src/sessions/sessionSearch.ts):

- Search by artist/title/album; rows show `artist — title · FLAC · 2026-05-01` with a red `missing` tag when `fileMissing`.
- Actions (all via `useShortcuts` + `Hint`, per the shortcuts philosophy): open containing folder, open in Picard, relocate, remove entry (ConfirmModal; optional "also delete file" — second confirm).

_Depends on: T23.1, T23.4_

---

### T23.6 — Batch "Open in Picard" (TODO backlog item)

- Contextual action on the task list multi-select and a library-modal action: open all saved files of the selection in MusicBrainz Picard in one `open` call batch (the per-track Picard plumbing from the MusicBrainz discovery column already exists — reuse its URI/open logic).

_Depends on: T23.2, T23.5_

---

### T23.7 — Tests

- Unit: `normalizeTrackKey` matrix (feat./remaster/case/diacritics), upsert/dedupe keying, store round-trip + atomic write.
- TUI harness: import-with-duplicate scenario (fixture library file) → badge + skip toggle; library modal search/open scenario.

_Depends on: T23.1–T23.6_

---

## Summary

| Task  | What                                                        | Depends on   |
| ----- | ----------------------------------------------------------- | ------------ |
| T23.1 | `libraryStore` + normalized-key indexes                     | —            |
| T23.2 | `saveTrack()` upsert hook                                   | T23.1        |
| T23.3 | Import-modal + task-list duplicate detection                | T23.1, T23.2 |
| T23.4 | Missing-file flags, relocate integration, auto-relocation   | T23.1, T23.2 |
| T23.5 | Searchable library modal with file actions                  | T23.1, T23.4 |
| T23.6 | Batch "Open in Picard"                                      | T23.2, T23.5 |
| T23.7 | Unit + TUI-harness coverage                                 | T23.1–T23.6  |
