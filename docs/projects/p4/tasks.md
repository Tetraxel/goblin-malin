# P4 — Metadata Source Management Panel: Tasks

## Context

**Current state of metadata data model:**

`MusicDownloadTaskAttributes` (via `TrackDownloadTask`) stores:

```typescript
metadataSources: TrackMetadata[];
```

`TrackMetadata` is a discriminated union of platform-specific types all sharing `BaseTrackMetadata`:

```typescript
type BaseTrackMetadata = {
  id;
  isrc;
  trackName;
  duration;
  trackNumber;
  url;
  uri;
  artists;
  album;
  platform;
  apiProvider;
  isPrimarySource?: boolean;
  fetchedAt;
  type: "track";
};
```

There is **no ranking, favorite, or rejected state** on any source. The array position is the implicit rank. There is **no compiled metadata** concept — no aggregation across sources. `bpm`, `key`, and `genres` fields do not exist in `BaseTrackMetadata` at all.

**How sources are currently added:**

`DownloadTask.addMetadataSource()` appends `TrackMetadata` directly to the array. `startPrimaryMetadataFetching()` sets `isPrimarySource = true` on the first hit. `startMetadataDiscovering()` appends secondary results.

**What the UI currently shows:**

`SpotifyCell` and `YoutubeCell` read directly from `metadataSources` using `find(m => m.apiProvider === 'spotify')`. They display just the ID portion of the URI. There is no sources panel, no source list, and no detail view.

**Where P4 plugs in:**

P2/T2.9 creates the `SourcesPanel` scaffold with an inner left/right split. P4 fills that scaffold with real components: a source list on the left and a full field detail view on the right, connected to a real data model.

---

## Tasks

### T4.1 ✅ — Extend `BaseTrackMetadata` with missing fields and wrap sources in `MetadataSourceState`

**Part A — Add missing fields to `BaseTrackMetadata` in `types.ts`:**

```typescript
type BaseTrackMetadata = {
  // ... existing fields ...
  bpm?: number;
  key?: string; // e.g. "Am", "F#"
  genres?: string[];
};
```

These are optional on all platform types. Only services that actually return them (e.g. Spotify returns BPM via the audio features endpoint, Deezer returns genres) will populate them.

**Part B — Introduce `MetadataSourceState` wrapper:**

```typescript
export type MetadataSourceState = {
  metadata: TrackMetadata;
  rank: number; // 0 = highest priority; lower = considered first
  isFavorited: boolean; // pinned as preferred for this provider (max one per provider)
  isRejected: boolean; // user marked as wrong match; excluded from compiled output
  confidence?: number; // 0–100 match score vs. primary; added in T4.13
};
```

**Part C — Add `metadataOverride` to `TrackDownloadTask`:**

```typescript
export type MetadataOverrides = Partial<{
  trackName: string;
  artists: StandardArtist[];
  isrc: string;
  album: StandardAlbum;
  year: number;
  trackNumber: number;
  bpm: number;
  key: string;
  genres: string[];
}>;

export type TrackDownloadTask = {
  toTag?: boolean;
  toDownload?: boolean;
  userInput: UserInput;
  metadataSources: MetadataSourceState[]; // was TrackMetadata[]
  metadataOverride: MetadataOverrides; // new
  downloadSources: TrackDownloadSource[];
  parentAlbumDownloadTask?: AlbumDownloadTask;
};
```

_Depends on: nothing_

---

### T4.2 ✅ — Migrate all existing code from `TrackMetadata[]` to `MetadataSourceState[]`

Several places read or write `metadataSources` directly and need updating after T4.1:

**`downloadTask.ts` — `addMetadataSource()`:**

```typescript
private addMetadataSource(metadata: TrackMetadata): void {
  const current = this.getAttributes()?.metadataSources ?? [];
  const state: MetadataSourceState = {
    metadata,
    rank: current.length,      // append at the end
    isFavorited: false,
    isRejected: false,
  };
  this.updateAttributes({ metadataSources: [...current, state] });
}
```

**`downloadTask.ts` — `startDownloads()`:**

Currently: `metadataSources.find(m => downloadService.canDownload(m))`
After: `metadataSources.find(s => downloadService.canDownload(s.metadata))`

**`downloadTask.ts` — `startMetadataDiscovering()`:**

Currently compares `service.id === primaryMetadata.id` where `primaryMetadata` is a `TrackMetadata`. After T4.1, primary source is `find(s => s.metadata.isPrimarySource)?.metadata`.

**`SpotifyCell.tsx`, `YoutubeCell.tsx`:**

Currently: `task.attributes?.metadataSources.find(m => m.apiProvider === 'spotify')`
After: `task.attributes?.metadataSources.find(s => s.metadata.apiProvider === 'spotify')?.metadata`

**`MusicDownloadFlow.getContextualActionBar()`:**

The action bar reads column IDs that start with `metadataService-` and calls handlers that currently reference task sources — update any such references.

_Depends on: T4.1_

---

### T4.3 ✅ — Implement `computeCompiledMetadata(sources, overrides)`

Create `src/flows/musicDownloadFlow/utils/compiledMetadata.ts`.

```typescript
export type FieldAttribution = Platform | "manual" | "none";

export type CompiledMetadata = {
  trackName: string;
  artists: StandardArtist[];
  duration?: number;
  isrc?: string;
  album?: StandardAlbum;
  year?: number;
  trackNumber?: number;
  bpm?: number;
  key?: string;
  genres?: string[];
  // which source provided each field (for display in the detail panel)
  attribution: Partial<
    Record<
      | "trackName"
      | "artists"
      | "duration"
      | "isrc"
      | "album"
      | "year"
      | "trackNumber"
      | "bpm"
      | "key"
      | "genres",
      FieldAttribution
    >
  >;
};

export function computeCompiledMetadata(
  sources: MetadataSourceState[],
  overrides: MetadataOverrides,
): CompiledMetadata;
```

**Algorithm:**

1. Filter out rejected sources (`s.isRejected === false`)
2. Sort remaining by `rank` ascending (lower rank = higher priority)
3. For each field in `CompiledMetadata`: take the first non-null/non-undefined value from the sorted sources; record its `platform` in `attribution[field]`
4. Apply `overrides` on top — any override field replaces the source-derived value; `attribution[field] = 'manual'`
5. `trackName` and `artists` are always present (fall back to empty string / `[]` if no sources exist)

This function is **pure** — it is not stored anywhere. Components call it at render time from `task.getAttributes()`. No caching needed at this stage (the source list is small).

_Depends on: T4.1_

---

### T4.4 ✅ — Build `MetadataSourceList` component (left side of SourcesPanel)

Create `src/components/SecondaryPanel/MetadataPanel/MetadataSourceList.tsx`.

**Props:**

```typescript
interface MetadataSourceListProps {
  sources: MetadataSourceState[];
  compiled: CompiledMetadata; // pre-computed, passed in from SourcesPanel
  selectedIndex: number; // -1 = compiled row selected, 0+ = source index
  isActive: boolean;
  width: number;
  height: number;
}
```

**Layout (one row per source, plus the compiled row at the top):**

```
  ☛ ◈ COMPILED    Petit Biscuit - Sunset Lover   3:44
    ● [SPOTIFY]   Petit Biscuit - Sunset Lover   3:44  ★
    ○ [YT MUSIC]  Petit Biscuit - Sunset Lover   3:44
    ✗ [MB]        Petit Biscuit - Sunset Lover   3:45     (rejected — dimmed)
```

- `◈` = compiled row icon; `●` = primary source; `○` = secondary; `✗` = rejected
- `★` = favorited (shown at right)
- Platform badge uses `SERVICE_DISPLAY_MAPPING` color
- Rejected rows rendered with `dimColor`
- Selected row: `☛` indicator at left (same pattern as `TaskListPanel`)
- Scrollable if sources exceed available height

The compiled row is always index `-1` and always at the top. It cannot be reordered, favorited, or rejected.

_Depends on: T4.1, T4.3_

---

### T4.5 ✅ — Build `MetadataDetailPanel` component (right side of SourcesPanel)

Create `src/components/SecondaryPanel/MetadataPanel/MetadataDetailPanel.tsx`.

> **Note:** Implemented as `MetadataDetailPanel` (not `MetadataSourceDetail`). Composed of sub-components `FieldRow.tsx`, `MetadataCompiledRow.tsx`, and `MetadataSourceRow.tsx` in the same folder.

**Props:**

```typescript
interface MetadataDetailPanelProps {
  source: MetadataSourceState | "compiled";
  compiled: CompiledMetadata;
  overrides: MetadataOverrides;
  selectedFieldIndex: number; // only relevant when source === 'compiled' and detail panel is focused
  isActive: boolean;
  width: number;
  height: number;
}
```

**Layout — regular source (read-only):**

```
  Title       Sunset Lover
  Artists     Petit Biscuit
  Duration    3:44
  ISRC        FRT092400049
  Album       Presence
  Year        2017
  Track #     1
  BPM         122
  Key         Am
  Genres      Electronic, Indie
  MB Rec.     —
  MB Release  —
  MB Artist   —
  MB Rel.Grp  —
```

**Layout — compiled row (shows source attribution, editable):**

Each field shows the value plus a dim attribution badge. If the field has a manual override, the badge reads `[EDITED]` in a distinct color. If the field is unfilled by any source, show `—` in dim.

```
  Title       Sunset Lover              [SPOTIFY]
  Artists     Petit Biscuit             [SPOTIFY]
  Duration    3:44                      [YT MUSIC]
  ISRC        FRT092400049              [EDITED]
  ...
```

When `isActive` and the detail panel has focus, `↑/↓` navigates between fields. The selected field is highlighted and its shortcut appears in the action bar (`[Enter]` to edit, `[Del]` to clear override).

_Depends on: T4.1, T4.3_

---

### T4.6 ✅ — Inline field editing for compiled metadata

When the detail panel is active, the compiled row is selected in the source list, and the user presses `Enter` on a field:

1. The field enters edit mode — renders `<TextInput>` (from `ink-text-input`) pre-filled with the current value
2. On submit: call `task.updateAttributes({ metadataOverride: { ...current, [field]: newValue } })`
3. On `Esc`: cancel without saving, return to field navigation
4. Pressing `Del` on a field that has an existing override: remove that key from `metadataOverride` (revert to source-computed value)

**Artists field** is a comma-separated string in the edit input, parsed back to `StandardArtist[]` on submit (split by `,`, trim, wrap as `{ type: 'artist', name }`).

**Year, Track#, BPM** fields: parse as integers on submit; reject non-numeric input (stay in edit mode with a red border).

The field edit state (`editingField: keyof MetadataOverrides | null`) lives as local React state in `MetadataSourceDetail` — it does not need to go into `FocusState`.

_Depends on: T4.5_

---

### T4.7 ✅ — Source list keyboard actions: favorite, reject, reorder

These actions are handled by the `useSourceListInput` hook (`src/hooks/useSourceListInput.ts`), called from `MetadataSourceList`. The hook also handles `[Enter]` to open the source URL in the desktop app and `[Ctrl+C]` to copy the URL.

**Contextual actions when source list is focused:**

| Key         | Label             | Condition                                      |
| ----------- | ----------------- | ---------------------------------------------- |
| `[F]`       | Favorite          | Selected row is not compiled, not rejected     |
| `[Del]`     | Reject / Unreject | Selected row is not compiled                   |
| `[Shift+↑]` | Move up           | Selected row is not compiled, not at rank 0    |
| `[Shift+↓]` | Move down         | Selected row is not compiled, not at last rank |

**Favorite logic:** `isFavorited` is toggled. Max one favorite per `metadata.platform` — when setting a new favorite for a platform, clear `isFavorited` on any existing favorite with the same platform. Favorited sources bubble to rank 0 (or near it) in the compiled metadata field selection.

**Reject logic:** Toggle `isRejected`. Rejected sources are kept in the array (to be shown dimmed and allow un-rejection) but excluded from `computeCompiledMetadata`. Rejecting a favorited source also clears `isFavorited`.

**Reorder:** Swap `rank` values between the selected source and the one immediately above or below in the sorted list. Re-sort the display after each swap. Cannot reorder past the compiled row (rank -1 is a reserved sentinel).

All mutations call `task.updateAttributes({ metadataSources: updatedSources })`.

_Depends on: T4.1, T4.4_

---

### T4.8 ✅ — Wire `SourcesPanel` to real components and focus state

Connect the placeholder `SourcesPanel` (P2/T2.9) to the real `MetadataSourceList` and `MetadataDetailPanel` components when `mode === 'metadata'`. Implemented at `src/components/SecondaryPanel/MetadataPanel/SourcesPanel.tsx`.

**Changes to `SourcesPanel`:**

```typescript
// inside SourcesPanel when mode === 'metadata':
const sources = selectedTask?.getAttributes()?.metadataSources ?? [];
const overrides = selectedTask?.getAttributes()?.metadataOverride ?? {};
const compiled = computeCompiledMetadata(sources, overrides);

<Box flexDirection="row">
  <MetadataSourceList
    sources={sources}
    compiled={compiled}
    selectedIndex={focusState.secondaryPanel.sourcesPanel.selectedSourceIndex}
    isActive={focusState.secondaryPanel.sourcesPanel.innerFocus === 'list'}
    width={leftWidth}
    height={height}
  />
  <MetadataSourceDetail
    source={selectedIndex === -1 ? 'compiled' : sources[selectedIndex]}
    compiled={compiled}
    overrides={overrides}
    selectedFieldIndex={focusState.secondaryPanel.sourcesPanel.selectedFieldIndex ?? 0}
    isActive={focusState.secondaryPanel.sourcesPanel.innerFocus === 'detail'}
    width={rightWidth}
    height={height}
  />
</Box>
```

Add `selectedFieldIndex: number` to `focusState.secondaryPanel.sourcesPanel` (alongside `selectedSourceIndex` and `innerFocus` from P1/T1.2).

Register `'metadataSourceList'` and `'metadataSourceDetail'` as focusable sub-windows within the secondary panel, and add keyboard handlers for `→`/`←` (or `Tab`) to switch `innerFocus` between them.

_Depends on: T4.4, T4.5, T4.6, T4.7, P2/T2.9, P1/T1.2_

---

### T4.9 ✅ — Trigger per-provider re-search from the source list

Currently metadata discovery only runs automatically in `DownloadTask.start()`. Users should be able to re-trigger a search from the panel.

**Two re-search modes:**

1. **Re-search all** (`[R]` when compiled row is selected): calls `task.startMetadataDiscovering()` again for all registered providers, upserts results (update existing `MetadataSourceState` for the same platform rather than appending a duplicate)

2. **Re-search single provider** (`[S]` when a specific source row is selected): calls the matching service's `searchTrack(primaryMetadata)` for that platform only, upserts the single result

**Upsert logic** (shared helper in `DownloadTask`):

```typescript
private upsertMetadataSource(metadata: TrackMetadata): void {
  const current = this.getAttributes()?.metadataSources ?? [];
  const existing = current.findIndex(s => s.metadata.platform === metadata.platform);
  if (existing >= 0) {
    // replace metadata, preserve rank/favorited/rejected
    const updated = [...current];
    updated[existing] = { ...updated[existing], metadata };
    this.updateAttributes({ metadataSources: updated });
  } else {
    this.addMetadataSource(metadata);
  }
}
```

This fills in the currently empty `onClick: () => {}` handler for the `"s" → Search` action in `MusicDownloadFlow.getContextualActionBar()`.

_Depends on: T4.2, T4.7_

---

---

### T4.10 ✅ — Fix `SourcesPanel` state re-render after mutations

**Problem:** `SourcesPanel` read task attributes directly via `getAttributes()` without subscribing to task changes. Mutations (favorite, reject, reorder) called `task.updateAttributes()` which notified task subscribers — but `SourcesPanel` had no subscriber, so React never re-rendered until cursor movement triggered an unrelated state change.

**Fix:** Use a `useEffect`-based subscription (`task.subscribe()`) inside `SourcesPanel` to update a local `snapshot` state whenever the task changes. All `sources` and `overrides` are derived from `snapshot` instead of from `getAttributes()` directly.

_Depends on: T4.8_

---

### T4.11 ✅ — Fix `Shift+↑/↓` key detection in `MetadataSourceList`

**Problem:** `key.shift && key.upArrow` (evaluated simultaneously) did not match Ink's key delivery reliably. The reorder shortcuts silently did nothing.

**Fix:** Restructure input handling to check the arrow key first, then check `key.shift` inside — the same pattern used in `src/hooks/useKeyHandlers.ts:36-43`:

```typescript
if (key.upArrow) {
  if (key.shift) {
    /* reorder up */ return;
  }
  /* normal navigation up */
}
```

_Depends on: T4.7_

---

### T4.12 ✅ — Add `SourcesHintBar` (two-row contextual hints)

Create `src/components/SecondaryPanel/MetadataPanel/SourcesHintBar.tsx`. Rendered inside `SourcesPanel` below the list/detail split (height = 2 rows). `SourcesPanel` reduces the height passed to `MetadataSourceList` and `MetadataDetailPanel` by `HINT_BAR_HEIGHT = 2`.

**Row 1 — source context path:**

```
Youtube > Track > Rfh_t-P-hh4 >>>   [Enter] Open link   [Ctrl+C] Copy link   [D] Download
```

When compiled row is selected: shows `"Compiled"` with no source-specific actions.

**Row 2 — list position + list actions:**

```
Source 3/12 >>>   [F] Favorite   [Del] Reject source   [Shift+↑] Move up   [Shift+↓] Move down
```

When compiled row is selected: shows `"Compiled >>>"` with `[Enter] Edit field` hint only.

Hints are dimmed when the secondary panel is not active.

_Depends on: T4.7, T4.8_

---

### T4.13 ✅ — Redesign `MetadataSourceList` layout + add confidence scoring

**Part A — Add `confidence?: number` to `MetadataSourceState`** (`src/flows/musicDownloadFlow/types.ts`):
Field holds a 0–100 match score vs the primary source; `undefined` when not computed.

**Part B — `src/flows/musicDownloadFlow/utils/confidence.ts`** (new pure utility):
`computeConfidenceScore(source, primary)` scores field matches:

- ISRC exact → 100 immediately
- Track name normalized exact: 40 pts (substring: 25 pts)
- First artist name: 30 pts (substring: 15 pts)
- Duration within 2%: 20 pts (within 5%: 10 pts)
- Release year: 10 pts

**Part C — Compute confidence on upsert** (`src/flows/musicDownloadFlow/utils/downloadTask.ts`):
`addMetadataSource` and `upsertMetadataSource` compute `confidence` via `computeConfidenceScore` and store it in `MetadataSourceState`. Primary source always gets `confidence = 100`.

**Part D — Redesign `MetadataSourceList` layout:**

```
Top-ranked favorite sources are more likely to be used for downloading
🏆  Artist – Title (N unsaved edits)                                    >>>
☛ ★ [100%] Spotify > Track > 3Rlc… > Artist – Title (3:40)
  ? [ 91%] Youtube > Track > Rfh_… > Artist – Title (3:32)
  ✘ [ 30%] Youtube > Track > WxX…  > David Guetta – … (6:07)
```

- Fixed header description line (gray italic)
- Compiled row: trophy icon + compiled artist–title + unsaved edits count + right-aligned `>>>`
- Status icon: `★` favorited · `✘` rejected · `?` default
- Confidence badge `[NNN%]` color-coded: ≥90 green · ≥70 yellow · ≥50 gray · <50 red
- Row path: `Platform > Type > ID > Artist – Title (duration)` as a single truncated string

_Depends on: T4.1, T4.4, T4.7_

---

## Summary

| Task     | What                                                                                                    | Depends on                               |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| T4.1 ✅  | Add `bpm`/`key`/`genres` to `BaseTrackMetadata`; introduce `MetadataSourceState` and `metadataOverride` | —                                        |
| T4.2 ✅  | Migrate all code from `TrackMetadata[]` to `MetadataSourceState[]`                                      | T4.1                                     |
| T4.3 ✅  | `computeCompiledMetadata()` — pure aggregation function with attribution                                | T4.1                                     |
| T4.4 ✅  | `MetadataSourceList` — scrollable ranked source list with indicators                                    | T4.1, T4.3                               |
| T4.5 ✅  | `MetadataDetailPanel` — full field display, attribution badges (renamed from MetadataSourceDetail)      | T4.1, T4.3                               |
| T4.6 ✅  | Inline field editing for compiled metadata overrides                                                    | T4.5                                     |
| T4.7 ✅  | Keyboard actions: `[F]` favorite, `[Del]` reject, `[Shift+↑/↓]` reorder (`useSourceListInput` hook)     | T4.1, T4.4                               |
| T4.8 ✅  | Wire `SourcesPanel` to real components + focus state                                                    | T4.4, T4.5, T4.6, T4.7, P2/T2.9, P1/T1.2 |
| T4.9 ✅  | Per-provider re-search from the source list                                                             | T4.2, T4.7                               |
| T4.10 ✅ | Fix `SourcesPanel` re-render after mutations (task subscription)                                        | T4.8                                     |
| T4.11 ✅ | Fix `Shift+↑/↓` key detection in `MetadataSourceList`                                                   | T4.7                                     |
| T4.12 ✅ | `SourcesHintBar` — two-row contextual shortcuts bar below the sources panel                             | T4.7, T4.8                               |
| T4.13 ✅ | Redesign `MetadataSourceList` layout + confidence scoring                                               | T4.1, T4.4, T4.7                         |
