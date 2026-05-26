# P11 — Songlink and New Metadata Structure

## Context

Two problems motivate this project:

1. **Spotify requires premium.** `startPrimaryMetadataFetching` fails for most users when a Spotify URL is entered. Songlink can provide rudimentary fallback metadata (title, artist, linked platform URIs) when Spotify is unavailable.
2. **The flat `MetadataSourceState[]` loses structure.** Currently each platform yields at most one result, there's no provenance (how was it found?), and reordering mixes results across providers.

P11 redesigns the metadata structure as grouped results per platform, adds multi-result search, discovery provenance tracking, and introduces `DiscoveryMetadataService` (Songlink as first implementation) for cross-platform URI discovery and primary-fetch fallback.

---

## Data Structure Reference

### Changes to `BaseTrackMetadata`

Add one optional field:

```typescript
fetchedBy?: APIProvider;
// If set and different from apiProvider, indicates rudimentary/fallback metadata.
// e.g. platform="youtube", apiProvider="youtube", fetchedBy="songlink"
// → this YouTube track was discovered by Songlink, not fetched by the YouTube service.
// The enrichment logic compares fetchedBy vs apiProvider to decide if enrichment is worthwhile.
// Once enrichment succeeds, fetchedBy is absent (or equal to apiProvider) on the new metadata object.
// Once enrichment fails (fetchState="error"), we stop retrying.
```

Add `"songlink"` to the `APIProvider` union.

### New types

```typescript
// Which fields of the source metadata were used to find this result
export type SearchKey =
    | "url"
    | "isrc"
    | "trackName"
    | "artistName"
    | "trackName+artistName"
    | "trackName+artistName+isrc";
// Display labels: "url"→"URL", "isrc"→"ISRC", "trackName"→"Title",
//                 "artistName"→"Artist Name", combined keys expand naturally

// Provenance: one entry per path that led to a given URI being discovered
export type DiscoverySource = {
    discoveredBy: string; // service key: "spotify", "songlink", "youtube"
    fromUri: string; // source URI used as input: "SPOTIFY::TRACK::abcd"
    searchKeys: SearchKey[]; // what fields were used for this search path
};

// One result within a platform group
export type MetadataResultState = {
    metadata: TrackMetadata;
    isPrimaryInput: boolean; // true only for the user's original URL input
    isFavorited: boolean; // max 1 per group
    isRejected: boolean;
    rank: number; // within-group ordering (lower = higher priority)
    confidence?: number; // 0–100 vs primary input metadata
    discoverySources: DiscoverySource[]; // empty for the primary input result
    fetchState?: "loading" | "error"; // used when metadata is being enriched or failed
    fetchError?: string;
};

// A group of results for one platform
export type MetadataGroupState = {
    platform: Platform;
    serviceKey: string; // "spotify", "youtube"
    rank: number; // cross-group ordering (lower = higher priority)
    results: MetadataResultState[];
    // Note: no groupNote field — the render layer derives any warning from the primary
    // input result's metadata.fetchedBy vs metadata.apiProvider comparison.
};

// Return type for MetadataService.searchTrack (replaces single TrackMetadata)
export type SearchTrackResult = {
    metadata: TrackMetadata;
    searchKeys: SearchKey[]; // which fields of the source metadata drove this search
};
```

### Type removals

- `MetadataSourceState` — fully removed; all call sites updated
- `DiscoveryResult` — not introduced; `discoverFromUri` returns `TrackMetadata[]` directly (rudimentary metadata with `fetchedBy` set)

### TrackDownloadTask

```typescript
// Before:
metadataSources: MetadataSourceState[];
// After:
metadataGroups: MetadataGroupState[];
```

Same change on `TracksDownloadTask`.

### Cursor model (UI-only, lives in FocusContext — not in task attributes)

```typescript
export type CursorPosition =
    | { type: "compiled" }
    | { type: "group"; groupIndex: number }
    | { type: "result"; groupIndex: number; resultIndex: number };
```

---

## New Abstract Classes

### `DiscoveryMetadataService`

New file: `src/flows/musicDownloadFlow/discoveryMetadataService.ts`

```typescript
export abstract class DiscoveryMetadataService extends ServiceBase {
    // sourceMetadata contains the URL (and URI) of the track to look up.
    // Returns rudimentary TrackMetadata objects for each discovered platform,
    // each with fetchedBy set to this service's key and sparse fields.
    abstract discoverFromUri(sourceMetadata: TrackMetadata): Promise<TrackMetadata[]>;
}
```

No `parseUrl` — discovery services do not recognize user-facing URLs as primary inputs.

### Updated `MetadataService.searchTrack`

```typescript
// Before:
abstract searchTrack(sourceTrackMetadata: TrackMetadata): Promise<TrackMetadata>;
// After:
abstract searchTrack(sourceTrackMetadata: TrackMetadata): Promise<SearchTrackResult[]>;
```

Each result includes which search keys were used so the UI can show `└─ found by X using Y (Title, Artist Name)`.

---

## SonglinkService

`src/flows/musicDownloadFlow/services/metadata-providers/songlink/SonglinkService.ts`

Uncomment and rewrite as `class SonglinkService extends DiscoveryMetadataService`.

**`discoverFromUri(sourceMetadata)`:**

1. Use `sourceMetadata.url` as the Songlink API query parameter
2. Call `SonglinkClient.get({ url, userCountry: "FR", songIfSingle: "true" })`
3. Parse `linksByPlatform` and `entitiesByUniqueId` from the response
4. For each platform entry in `linksByPlatform` (excluding the source platform):
    - Find corresponding entity in `entitiesByUniqueId`
    - Construct a `TrackMetadata` with:
        - `platform` and `apiProvider` from the entity's data
        - `fetchedBy: "songlink"`
        - `trackName`, `artists`, `id`, `url` from the entity/link
        - `uri` constructed as `PLATFORM::TRACK::id`
        - Sparse other fields (no duration, album, isrc, etc.)
5. Return the array

`convertSonglinkToTrack.ts` — uncomment only entity extraction helpers; export a standalone conversion function used by `SonglinkService`.

`static readonly display: ProviderDisplay` — add to `providerDisplay.ts`. Songlink appears in Settings under a **Discovery providers** sub-list within the Metadata section (see T08). It supports enable/disable toggle and has no setup wizard (free API, no auth).

---

## Workflow Changes (`downloadTask.ts`)

### `startPrimaryMetadataFetching` — new logic

```
1. Iterate ALL MetadataService constructors registered (including disabled ones)
   by calling static parseUrl(url) on each constructor to find a recognizer.

2. If the recognizing service is ENABLED:
   a. Try service.getTrackMetadata(url)
   b. On success → create MetadataGroupState with one MetadataResultState
      (isPrimaryInput: true, discoverySources: [], no fetchedBy on metadata)
   c. On error → fall through to step 3

3. If disabled OR all enabled services failed:
   a. Try each DiscoveryMetadataService.discoverFromUri(stubMetadata)
      where stubMetadata is a minimal object with .url = the input URL
   b. For each returned rudimentary TrackMetadata matching the recognized platform:
      - Create MetadataResultState (isPrimaryInput: true, fetchedBy: "songlink")
      - Try to enrich with the real MetadataService.getTrackMetadata(result.url)
        → if success: replace metadata (fetchedBy absent in new object)
        → if fail: keep rudimentary metadata, set fetchState: "error"
   c. Create MetadataGroupState from this result

4. If nothing found: throw error, set status to "Primary metadata unavailable"
```

During fetching: set `fetchState: "loading"` on the primary result while the request is in flight.

**Accessing all constructors regardless of enabled state:** `ServiceRegistry` gains a method (e.g. `getAllConstructors()`) that iterates registered constructors without the `isEnabled` filter.

### `startMetadataDiscovering` — new logic

```
Phase A — MetadataService.searchTrack:
  For each enabled MetadataService (skip the primary platform's service):
    results = service.searchTrack(primaryMetadata)  → SearchTrackResult[]
    For each result:
      → addResultToGroup(result.metadata, serviceKey, discoverySources=[{
            discoveredBy: serviceKey,
            fromUri: primaryUri,
            searchKeys: result.searchKeys
        }])

Phase B — DiscoveryMetadataService.discoverFromUri:
  For each enabled DiscoveryMetadataService:
    discovered = service.discoverFromUri(primaryMetadata)  → TrackMetadata[]
    For each discovered TrackMetadata (with fetchedBy="songlink"):
      Find or create MetadataGroupState for discovered.platform
      Dedup by URI: if same URI already exists in group (from Phase A):
        → append DiscoverySource to existing result's discoverySources
      Else:
        → Try MetadataService.getTrackMetadata(discovered.url) for enrichment
          → success: use enriched metadata (no fetchedBy)
          → fail: use rudimentary metadata (fetchedBy="songlink"), fetchState="error"
        → addResultToGroup with discoverySources=[{
              discoveredBy: "songlink", fromUri: primaryUri, searchKeys: ["url"]
          }]
```

**Deduplication key:** `metadata.uri` within a group. Same URI from Phase A + Phase B → one `MetadataResultState` with two `DiscoverySource` entries.

### Updated helpers

- `addMetadataSource` → replace with `addResultToGroup(metadata, serviceKey, discoverySources, isPrimaryInput?)` — finds or creates the group, upserts by URI
- `getPrimaryMetadata()` → traverse groups to find result with `isPrimaryInput: true`
- `startSingleProviderSearch(serviceKey)` → re-runs search for a group, merges new results
- `startDownloads` → iterate groups + results to find compatible `TrackMetadata` (replaces flat `metadataSources.find(...)`)

### Discovery service registry

`DownloadTask` gains:

```typescript
private discoveryServices: ServiceScope<DownloadTask, DiscoveryMetadataService>;
```

Passed in from `MusicDownloadFlow` alongside the existing registries.

---

## Settings Integration (`DiscoveryMetadataService`)

In the Settings panel, the **Metadata** section gains a **Discovery providers** sub-list below the existing **Providers** list. Layout is nearly identical (enable/disable toggle, optional setup wizard, status). Songlink appears here with enable/disable only (no API key needed). This requires:

- `MusicDownloadFlow` to expose `discoveryServiceRegistry` alongside `metadataServiceRegistry` for settings read/write
- Settings storage key: `metadata.discoveryProviders` (mirrors `metadata.providers`)
- The settings UI component iterates `discoveryServiceRegistry` registered entries

---

## UI Changes

### URI format change

Old: `Spotify > Track > abcd`
New: `Spotify::Track::abcd`

Applied everywhere: `MetadataResultRow`, `DiscoverySourceLine`, `SourcesHintBar`.

### New `MetadataUri` component

`src/components/SecondaryPanel/MetadataPanel/MetadataUri.tsx`

Props: `uri: string`, `platform: string`, `fetchState?: "loading" | "error"`, `dimmed?: boolean`

- Splits `uri` on `::` → `[PLATFORM, TRACK, id]`
- Colors parts with `providerDisplayRegistry.get(platform).color`; `::` separators in dim neutral
- `fetchState="loading"`: all parts grayed + inline `<Spinner>`
- `fetchState="error"`: all parts red + `✘` prefix; `fetchError` shown to the right on the main row (outside this component — the parent row handles placement)

### New `DiscoverySourceLine` component

`src/components/SecondaryPanel/MetadataPanel/DiscoverySourceLine.tsx`

Renders (1 row, not selectable):

```
      └─ found by Songlink using Spotify::Track::abcd (URL)
```

Props: `source: DiscoverySource`, `width: number`, `dimmed?: boolean`

`searchKeys` → human-readable: `"url"`→`"URL"`, `"trackName"`→`"Title"`, `"artistName"`→`"Artist Name"`, `"isrc"`→`"ISRC"`. Combined keys (e.g. `"trackName+artistName"`) expand to `"Title, Artist Name"`.

Uses `MetadataUri` for the `fromUri` part.

### New `MetadataGroupHeader` component

`src/components/SecondaryPanel/MetadataPanel/MetadataGroupHeader.tsx`

Renders (1 row):

```
Spotify (3 results)   Note: Spotify is not available but rudimentary metadata were fetched from Songlink
```

The note is derived in this component: if the group's primary input result has `metadata.fetchedBy` set and it differs from `metadata.apiProvider`, show a note like `"Note: {Platform} is not available but rudimentary metadata were fetched from {fetchedByLabel}"`.

Props: `group: MetadataGroupState`, `isSelected: boolean`, `isActive: boolean`, `width: number`

Platform label in provider color; note in dim italic, truncated to fit.
Selection indicator `☛ ` prefix.

### New `MetadataResultRow` component

`src/components/SecondaryPanel/MetadataPanel/MetadataResultRow.tsx`

Replaces `MetadataSourceRow`. Key differences:

- URI rendered via `MetadataUri` with `::` separators
- Badge: `[USER]` for `isPrimaryInput`, `[XX%]` for others (same confidence color logic)
- Status icon: `★` favorited, `✘` rejected, ` ` otherwise (no `?`)
- Discovery source lines rendered below when `showDiscoverySources === true`: one `DiscoverySourceLine` per entry in `result.discoverySources`
- `fetchError` shown to the right of the URI when `fetchState="error"` (inline, color red)
- Height: 1 + (showDiscoverySources ? discoverySources.length : 0) rows

### `MetadataSourceList` rework

Props change:

```typescript
// Before:
sources: MetadataSourceState[];
selectedIndex: number;
onSourcesChange: (sources: MetadataSourceState[]) => void;

// After:
groups: MetadataGroupState[];
cursor: CursorPosition;
showDiscoverySources: boolean;
onGroupsChange: (groups: MetadataGroupState[]) => void;
onCursorChange: (cursor: CursorPosition) => void;
```

Rendering order: compiled row → for each group (sorted by `rank`): `MetadataGroupHeader` → for each result (sorted by `rank`): `MetadataResultRow` + `DiscoverySourceLine`s.

Height is dynamic per group/result row. Viewport slicing must account for variable row heights when clamping to `maxSourceRows`.

`HINT_BAR_HEIGHT` becomes dynamic: `cursor.type === "result" ? 3 : 2`. Computed in `MetadataPanel` and passed as `height` to `MetadataSourceList`.

### `useSourceListInput` rework

Signature change to match new props. Flat traversal order for `↑`/`↓`:

```
compiled → group[0] header → result[0][0] → result[0][1] → ... → group[1] header → result[1][0] → ...
```

Key bindings:

- `↑`/`↓`: navigate in traversal order
- `Shift+↑`/`Shift+↓`:
    - On group cursor: swap group ranks with adjacent group
    - On result cursor: swap result ranks within its group
- `Enter`: open URL of focused result
- `Ctrl+C`: copy URL of focused result
- `F`: favorite/unfavorite focused result; unfavorite all others in same group
- `Del`:
    - On result cursor: toggle `result.isRejected`
    - On group cursor: toggle all results in group rejected/unrejected
- `E`: toggle `showDiscoverySources` (calls `onToggleDiscoverySources`)
- `R`: call `onRefetchResult(groupIndex, resultIndex)` for focused result

### `SourcesHintBar` rework

Three cursor contexts:

**Compiled:**

- Row 1: (empty)
- Row 2: `Compiled Metadata >>>`

**Group header:**

- Row 1: `{Platform} >>>  [Del] Reject all  [Shift+↑] Move up  [Shift+↓] Move down`
- Row 2: `Metadata Panel >>>  [Shift+←] Shrink  [Shift+→] Expand  [E] Toggle search details`

**Result:**

- Row 1: `{MetadataUri} >>>  [Enter] Open link  [Ctrl+C] Copy link`
- Row 2: `Source X/N >>>  [F] Set as favorite  [Del] Reject source  [Shift+↑] Move up  [Shift+↓] Move down  [R] Refetch`
- Row 3: `Metadata Panel >>>  [Shift+←] Shrink  [Shift+→] Expand  [E] Toggle search details`

Row 1 uses `MetadataUri` for the URI display (`::` separators).

### `FocusContext` / `useFocusManager`

In `sourcesPanel` focus state:

- Replace `selectedSourceIndex: number` with `cursor: CursorPosition`
- Add `showDiscoverySources: boolean` (initial: `false`)

---

## Task List

| #   | Title                                               | Files                                                     | Deps               | Status  |
| --- | --------------------------------------------------- | --------------------------------------------------------- | ------------------ | ------- |
| T01 | Core type definitions                               | `types.ts`                                                | —                  | ✅ Done |
| T02 | Abstract service contracts                          | `metadataService.ts`, `discoveryMetadataService.ts` (new) | T01                | ✅ Done |
| T03 | compiledMetadata adapter                            | `compiledMetadata.ts`                                     | T01                | ✅ Done |
| T04 | SpotifyService: update searchTrack                  | `SpotifyService.ts`                                       | T02                | ✅ Done |
| T05 | YoutubeService: update searchTrack                  | `YoutubeService.ts`                                       | T02                | ✅ Done |
| T06 | SonglinkService: implement DiscoveryMetadataService | `SonglinkService.ts`, `convertSonglinkToTrack.ts`         | T02                | ✅ Done |
| T07 | providerDisplay: add Songlink entry                 | `providerDisplay.ts`                                      | —                  | ✅ Done |
| T08 | Register Songlink; add discovery registry           | `musicDownloadFlow.ts`                                    | T06, T07           | ✅ Done |
| T09 | downloadTask orchestration rewrite                  | `downloadTask.ts`                                         | T02, T03, T08      | ✅ Done |
| T10 | FocusContext: cursor model + showDiscoverySources   | `useFocusManager.ts`                                      | T01                | ✅ Done |
| T11 | MetadataUri component                               | `Uri.tsx` (new) — named `Uri`, not `MetadataUri`          | T01                | ✅ Done |
| T12 | DiscoverySourceLine component                       | `DiscoverySourceLine.tsx` (new)                           | T01, T11           | ✅ Done |
| T13 | MetadataGroupHeader component                       | `MetadataGroupHeader.tsx` (new)                           | T01                | ✅ Done |
| T14 | MetadataResultRow component                         | `MetadataResultRow.tsx` (new)                             | T11, T12           | ✅ Done |
| T15 | MetadataSourceList rework                           | `MetadataSourceList.tsx`                                  | T10, T13, T14      | ✅ Done |
| T16 | useSourceListInput rework                           | `useSourceListInput.ts`                                   | T10, T15           | ✅ Done |
| T17 | SourcesHintBar: three cursor contexts               | `SourcesHintBar.tsx`                                      | T10, T11           | ✅ Done |
| T18 | MetadataPanel: wire new props and cursor            | `MetadataPanel.tsx`                                       | T10, T15, T16, T17 | ✅ Done |
| T19 | MetadataDetailPanel: adapt for MetadataResultState  | `MetadataDetailPanel.tsx`, `metadataFields.ts`            | T01, T18           | ✅ Done |
| T20 | Cell components: ArtistCell, TrackCell, UrlCell     | `ArtistCell.tsx`, `TrackCell.tsx`, `UrlCell.tsx`          | T01, T09           | ✅ Done |
| T21 | Action bar: musicDownloadFlow updates               | `musicDownloadFlow.ts`                                    | T09                | ✅ Done |
| T22 | Settings: Discovery providers sub-list              | `buildFlowSettingsItems.ts`                               | T08                | ✅ Done |
| T23 | Cleanup: remove MetadataSourceRow                   | `MetadataSourceRow.tsx`                                   | T14, T15           | ✅ Done |

### Deviations from plan

- **T11 file name:** Component is `Uri` in `Uri.tsx`, not `MetadataUri` in `MetadataUri.tsx`. Interface name kept as `MetadataUriProps`. The component also gained a `fetchedBy?: string` prop (not in original spec) for displaying rudimentary-metadata attribution on the URI row.
- **T20 scope:** The plan listed `SpotifyCell.tsx` and `YoutubeCell.tsx`, but all three column cells (`ArtistCell`, `TrackCell`, `UrlCell`) were updated to read from `metadataGroups` instead of the removed `metadataSources`.
- **T22 location:** Discovery providers sub-list was implemented in `buildFlowSettingsItems.ts` rather than a separate Settings UI component file.
- **New files (not in plan):** `src/components/SecondaryPanel/utils.ts` (shared panel utilities), `src/utils/decorators.ts` (`@Cached` decorator used by `SonglinkService`), `src/utils/color.ts` (`darken` helper used in `Uri`).

### Implementation order

```
T01 (types)
  ├── T02 (service contracts)
  │     ├── T04 (Spotify searchTrack)
  │     ├── T05 (YouTube searchTrack)
  │     └── T06 (SonglinkService)
  │           └── T08 (register + registry)
  ├── T03 (compiledMetadata)
  ├── T07 (providerDisplay)
  └── T09 (downloadTask) ← needs T02, T03, T08
        └── T20, T21
T10 (FocusContext cursor)
  ├── T11 (Uri)
  │     ├── T12 (DiscoverySourceLine)
  │     └── T17 (SourcesHintBar)
  ├── T13 (MetadataGroupHeader)
  ├── T14 (MetadataResultRow) ← needs T11, T12
  ├── T15 (MetadataSourceList) ← needs T13, T14
  │     └── T16 (useSourceListInput)
  └── T18 (MetadataPanel) ← needs T15, T16, T17
        └── T19 (MetadataDetailPanel)
T22 (Settings) ← needs T08
T23 (cleanup) ← needs T14, T15
```

All tasks completed. Safe incremental path followed: T01 → T02 → T03 → T07 → T04 → T05 → T06 → T08 → T09 _(backend compiles)_ → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20 → T21 → T22 → T23.

---

## Architectural Notes & Risks

**Deduplication key:** `metadata.uri` within a group. When Phase A (searchTrack) and Phase B (discoverFromUri) both find the same URI, they produce one `MetadataResultState` with two entries in `discoverySources`.

**Enrichment vs retry:** once `fetchState: "error"` is set on a result, the system does not retry automatically. The user can press `[R]` to trigger a manual refetch.

**Discovery registry isolation:** `DiscoveryMetadataService` must not be in `metadataServiceRegistry`. It has no column cell, no `parseUrl`, no `searchTrack`. A separate `discoveryServiceRegistry` prevents it from interfering with column rendering and Phase A discovery.

**Dynamic hint bar height:** `cursor.type === "result"` adds a third row. The ±1 row fluctuation on cursor change is acceptable in Ink (full re-render on state change). Variable discovery-source lines already make list height non-fixed.

**Disabled service URL parsing:** `ServiceRegistry.getAllConstructors()` must return all registered constructors regardless of `isEnabled`, so that `startPrimaryMetadataFetching` can identify the platform from a URL even when the service is disabled.

**`BaseTrackMetadata` required fields for rudimentary metadata:** Songlink provides `id`, `trackName`, `artists` (from `artistName`), `url`, `platform`, `apiProvider`, `type: "track"`, `fetchedAt`. All required fields of `BaseTrackMetadata` are satisfiable. Optional fields (`isrc`, `duration`, `album`, etc.) are absent.

---

## Verification

1. `yarn run type-check` — no new errors beyond pre-existing ones
2. `yarn run dev` — TUI starts normally
3. Enter a Spotify URL → primary Spotify group appears, loading spinner on URI → resolves to full metadata or Songlink-fallback rudimentary metadata (group header shows derived note)
4. Discovery phase completes → YouTube group appears with `└─ found by` lines under results
5. Navigate `↑`/`↓`: compiled → Spotify group header → Spotify results → YouTube group header → YouTube results
6. Press `[E]`: discovery source lines toggle visibility
7. Press `[F]` on a result: star appears; only one per group
8. Press `[Shift+↑]` on a group header: group moves up in list order
9. Press `[Del]` on a group header: all results in group marked rejected
10. Press `[R]` on a rudimentary result: refetch triggered, spinner appears
