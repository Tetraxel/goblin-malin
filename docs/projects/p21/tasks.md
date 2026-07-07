# P21 — Playlist & Album Import: Tasks

## Context

**The single biggest workflow multiplier the app is missing.** Users organize music in playlists and buy/track albums — importing one playlist should import 50 tracks. Today it imports zero:

- `detectUrls()` ([detectUrls.ts](../../../src/components/ImportModal/detectUrls.ts)) keeps every URL, and `SpotifyService.parseUrl` already recognizes `type: "album" | "playlist"` (`ParsedUrl` in [urlParser.ts](../../../src/base/urlParser.ts) has carried these types since P15).
- But `resolveTrackRecognition()` ([resolveTrackRecognition.ts](../../../src/flows/musicDownloadFlow/utils/resolveTrackRecognition.ts)) only returns a recognition when `parsed.type === "track" && parsed.id`. A pasted playlist URL therefore becomes a permanently-"Unknown" task that can never fetch anything — worse than an error, it looks broken.

**Design principle** (per the provider-extensibility philosophy): collection expansion is a per-service capability declared on the service class — no hardcoded platform logic in the import modal or the flow.

### Revision (this version of the doc)

The original version of this plan expanded a playlist/album to its full track list **inside the Import modal**, before confirm, tagging the resulting flat tracks with an `importGroup` for provenance. That was replaced with a different shape, at the user's direction:

- **No network calls in the Import modal.** A pasted album/playlist is recognized (regex-only, via the existing `parseUrl`/`detectUrls` path — no change needed there) but not expanded at import time.
- It becomes one **parent task** in the list. Starting it (same `r` action as any task) is what fetches its track list.
- Starting it creates **child tasks** nested under it — real rows, with normal per-track contextual actions, plus parent-only actions (Restart, Refetch, Collapse/Expand, and for playlists, toggle LIVE refresh).
- **Parent tasks can be collapsed** to hide their children.
- **Playlists support LIVE refresh**: periodic polling re-fetch (no Spotify push/webhook API exists for this), one **global** interval setting, a "fetched N ago" indicator, and a **per-playlist** on/off toggle (default on).

**Revised again, after trying the "pending only" behavior**: newly-discovered child tracks (fresh expand or a live-refresh tick) are now auto-started immediately — sitting idle until a manual "Run All" felt wrong for tracks the user didn't explicitly paste in. `CollectionTask.fetchAndSpawn()` calls `orchestrator.processTasks(new Set(newChildIds))` right after `addTasks()`, scoped to just the newly-created ids so it doesn't touch unrelated pending tasks elsewhere in the list. They still carry `toTag`/`toDownload` inherited from the parent's own flags (same Import-modal choice as today: Fetch Metadata & Download / Fetch Metadata / Do nothing) — those booleans govern *what* the auto-started run does, not *whether* it starts.

---

## Architecture decisions

1. **Two task shapes, one union.** `MusicDownloadTaskAttributes` becomes `TrackDownloadTask | CollectionDownloadTask` ([types.ts](../../../src/flows/musicDownloadFlow/types.ts)), discriminated by `kind: "track" | "collection"`. `TrackDownloadTask` gains `parentTaskId?: string`. This replaces the pre-existing dead scaffolding in `types.ts` (`AlbumDownloadTask`/`TracksDownloadTask`/commented `PlaylistDownloadTask` — unused anywhere in the codebase).
2. **A new `CollectionTask` class**, not a `DownloadTask` — it fetches a *listing*, not track metadata, and spawns real `DownloadTask` children tagged with `parentTaskId`. `DownloadTask` itself stays untouched (`Task<TrackDownloadTask>`), no collection concerns threaded through its metadata/discovery/download service scopes.
3. **Grouping/collapse is a pure display-order function, not an orchestrator feature.** The orchestrator stays a flat, content-agnostic task list (per P20b's philosophy — the engine knows nothing about task content). A new `buildVisibleTaskOrder(tasks)` reorders the flat list so each parent is immediately followed by its children (wherever they actually sit in the array — they're appended at the end when created), then drops children whose parent is collapsed. Used once, in `App.tsx`, to build the array handed down to rendering; session persistence keeps reading the orchestrator's raw flat list.
4. **Collapse and live-enabled state live on the task's own attributes** (`collapsed?`, `live?.enabled`) — like `toTag`/`toDownload` today, this persists for free through the existing session snapshot/restore, no new storage layer.
5. **Live refresh is a polling singleton**, not per-row timers: `liveRefreshScheduler` checks every 5s, scans the orchestrator's tasks for due, non-running, live-enabled playlist tasks, calls `.refetch()`. One global interval setting (in seconds); per-playlist state is just enabled/disabled.
6. **Recognition stays synchronous and network-free.** `resolveCollectionRecognition(url, registry)` mirrors `resolveTrackRecognition` — walks `registry.getAllConstructors()`, calls the static `parseUrl`, matches `type: "album"|"playlist"`. No network call until the resulting `CollectionTask` is actually started.

---

## Tasks

### T21.1 — Types & recognition

- `types.ts`: `kind` discriminant on `TrackDownloadTask` (`"track"`) and new `CollectionDownloadTask` (`"collection"`); `parentTaskId?: string` on `TrackDownloadTask`; `CollectionDownloadTask` = `{ collectionKind: "album"|"playlist"; state; userInput; recognizedServiceKey?; name?; ownerName?; totalCount?; truncated?; childTaskIds: string[]; collapsed?; toTag; toDownload; live?: { enabled; lastFetchedAt? }; error? }`; `MusicDownloadTaskAttributes = TrackDownloadTask | CollectionDownloadTask`. Remove the dead `AlbumDownloadTask`/`TracksDownloadTask`/commented types. New `CollectionExpansion` type (`kind`, `name`, `ownerName?`, `trackUrls: string[]`, `totalCount`, `truncated?`).
- [metadataService.ts](../../../src/flows/musicDownloadFlow/metadataService.ts): optional static `expandCollection?(url, logger): Promise<CollectionExpansion>` alongside `parseUrl`.
- New `utils/resolveCollectionRecognition.ts`: same shape as [resolveTrackRecognition.ts](../../../src/flows/musicDownloadFlow/utils/resolveTrackRecognition.ts), matching `type === "album" | "playlist"`.
- Legacy sessions with no `kind` on a task's attributes are treated as `"track"` at revive time — silent default, no migration needed.

_Depends on: nothing_

---

### T21.2 — `CollectionTask` engine + `taskFactory`

- New `utils/collectionTask.ts`: `CollectionTask extends Task<CollectionDownloadTask>`. `start()`, `restart()` (drop existing children via `orchestrator.removeTasks`, reset, re-`start()`), `refetch()` (idempotent: re-list, diff against `childTaskIds` by track id/url, only add new ones, update `name`/`totalCount`/`live.lastFetchedAt`), `toggleCollapsed()`, `toggleLive()` (playlists only). Shared private `fetchAndSpawn({ diffOnly })`: resolve the recognizing service from `metadataServiceRegistry`, call `expandCollection` gated through the existing `metadataLimiter` ([stageLimiters.ts](../../../src/flows/musicDownloadFlow/utils/stageLimiters.ts)), cap to `collections.defaultMaxTracks`, build children via the shared factory helper, `orchestrator.addTasks(children)` (single call — P20's batched `notifySubscribers` already coalesces the UI update).
- [taskFactory.ts](../../../src/flows/musicDownloadFlow/taskFactory.ts): extract `buildTrackTask(url, opts: { toTag, toDownload, parentTaskId? })` from the current `createTasksFromUrls` map body. `createTasksFromUrls` tries `resolveCollectionRecognition` first (→ new `CollectionTask`), else falls back to today's `resolveTrackRecognition` + `buildTrackTask` path. `createTasksFromSnapshots` branches on `snap.attributes.kind` (default `"track"`).
- [reviveTaskDates.ts](../../../src/flows/musicDownloadFlow/utils/reviveTaskDates.ts): branch by `kind` — collection path revives `live.lastFetchedAt`.

_Depends on: T21.1_

---

### T21.3 — Spotify `expandCollection`

- [SpotifyService.ts](../../../src/flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService.ts): official mode via the existing `@spotify/web-api-ts-sdk` client (`playlists.getPlaylistItems`/`albums.tracks`, paginated to `totalCount`). Skip `item.is_local` and episode entries. **Deviation from the plan-review sketch**: no scrape-mode fallback — `spotify-url-info`'s embed-page API has no documented playlist/album listing shape to implement with confidence, so scrape mode surfaces the existing "Spotify client not initialized (scrape mode active)" error instead of a guessed, unverifiable partial implementation. Also deliberately **not** wrapped in `@Cached()` (unlike the service's other calls) — the disk cache has no invalidation, so a cached `expandCollection` would make live-refresh refetches always return the original result forever, defeating the point of live refresh.

_Depends on: T21.1_

---

### T21.4 — YouTube `expandCollection`

- [YoutubeService.ts](../../../src/flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService.ts): `parseUrl` recognizes `youtube.com/playlist?list=` and `music.youtube.com/playlist?list=` as `type: "playlist"`. `expandCollection` via the existing `ytmusic-api` client (`getPlaylist` for name/owner + `getPlaylistVideos` for the track listing — the client paginates internally). YouTube Music albums use opaque browse-id URLs rather than `?list=`, too ambiguous to parse reliably, so `parseUrl` never recognizes them as collections — `expandCollection` only ever runs for playlists here.

_Depends on: T21.1_

---

### T21.5 — Rendering: grouping, collapse, collection-aware cells

- New `utils/buildVisibleTaskOrder.ts` (pure function, architecture decision #3). Wired into [App.tsx](../../../src/components/App.tsx): `visibleTasks = useMemo(() => buildVisibleTaskOrder(tasks), [tasks])` passed to `AppInner`/`FocusProvider` in place of the raw orchestrator `tasks` state (the session-persistence effects keep reading the raw flat list).
- Cell components ([columns/*.tsx](../../../src/flows/musicDownloadFlow/columns/)) gain a `kind === "collection"` branch: `UrlCell` (icon/name/owner/track-count/collapse arrow + child indent), `ArtistCell` (ownerName), `TrackCell` (name/count), `StatusCell` (fetching spinner, or ticking "Fetched Xs/m/h ago" via `useGlobalTicker` — same pattern as [AnimatedIcon.tsx](../../../src/components/AnimatedIcon.tsx)), `ToTagCell`/`ToDownloadCell` (toggle the parent's own flags + cascade to existing children). Provider cells (`SpotifyCell`, `YoutubeCell`, `YtDlpCell`, `MusicBrainzCell`, `SonglinkCell`) early-return blank for collection rows.
- `MetadataPanel.tsx`/`DownloadPanel.tsx`: placeholder when the selected task is a collection.

_Depends on: T21.1, T21.2_

---

### T21.6 — Contextual actions & shortcuts

- [contextualActions.ts](../../../src/flows/musicDownloadFlow/contextualActions.ts): new `buildCollectionContextualActionBar` — `r` Start/Restart, `f` Refetch (once fetched), `c` Collapse/Expand (if it has children), `l` Toggle live (playlist only), `Del` Delete (parent + children, via existing `deleteConfirmBridge`). `buildContextualActionBar` branches on `kind` and delegates; `ActionBar.tsx`/`useKeyHandlers.ts` need no structural change. (Dropped "select all tracks in this collection" from the original plan-review sketch — it would need `selectAllTasks` threaded from React context into this plain-function module for a not-explicitly-requested nicety; skipped to keep the change footprint tight.)
- [runController.ts](../../../src/flows/musicDownloadFlow/runController.ts): `runSelected`'s reset branches by kind (collection: reset state/status only; full teardown stays `restart()`'s job).

_Depends on: T21.2_

---

### T21.7 — Live refresh

- `CollectionDownloadTask.live?: { enabled; lastFetchedAt? }`, playlists only, `enabled: true` by default on creation.
- New `utils/liveRefreshScheduler.ts`: singleton, `start()` called once from [init.ts](../../../src/flows/musicDownloadFlow/init.ts). Checks every 5s, scans `TaskOrchestrator.getTasks()` for due/non-running/live-enabled playlist tasks, calls `.refetch()` (fire-and-forget, errors logged).
- [settings.ts](../../../src/flows/musicDownloadFlow/settings.ts): new `collections: { defaultLiveRefreshIntervalSeconds; defaultMaxTracks }` (defaults `120`, `500`).
- [buildFlowSettingsItems.ts](../../../src/flows/musicDownloadFlow/buildFlowSettingsItems.ts): new "Collections" section, two `textInput` numeric fields.

_Depends on: T21.2_

---

### T21.8 — Sessions

- [sessionSearch.ts](../../../src/sessions/sessionSearch.ts): `deriveSessionName` prefers a collection's `name`; `sessionMatchesQuery`/`getSessionMatches` branch on `kind`.

_Depends on: T21.1_

---

### T21.9 — Tests

- Unit (vitest, `tests/unit/`): `resolveCollectionRecognition.test.ts` (recognition matrix against fixture `MetadataService` subclasses, no network); `buildVisibleTaskOrder.test.ts` (grouping/collapse/orphan-parent ordering cases).
- TUI harness: `scripts/tui-test/examples/collection-import.json` + a new fixture `scripts/tui-test/fixtures/collection-import/` (hand-crafted `sessions.json`, mirroring `50-tasks`' shape) with an already-finished playlist (3 children, live-enabled) and a collapsed album (2 hidden children) — covers render (badges, indent, "Fetched X ago"), collapse/expand, and the live-refresh toggle end-to-end. Wired into the vitest suite via `tests/e2e/collections.test.ts`.
- **Not covered**: the actual `expandCollection` network path end-to-end (no real Spotify/YouTube credentials available in this environment to record a cache fixture the way `50-tasks-with-metadata` was built) and a `CollectionTask.fetchAndSpawn` unit test (its cap/diff logic reads live settings via `getMusicSettings()`, which is disk-backed and only cleanly isolated per-process via `GOBLIN_DATA_DIR` — the TUI harness's out-of-process model handles that; an in-process vitest unit test would either need real disk I/O or the module split further to inject settings, judged not worth it for this pass). Both are reasonable follow-ups for whoever next touches this area.

_Depends on: T21.1–T21.8_

---

## Summary

| Task  | What                                                              | Depends on   |
| ----- | ------------------------------------------------------------------ | ------------ |
| T21.1 | Types (`kind` union, `CollectionDownloadTask`, `parentTaskId`) + `resolveCollectionRecognition` | — |
| T21.2 | `CollectionTask` engine (start/restart/refetch/collapse/live) + `taskFactory` refactor | T21.1 |
| T21.3 | Spotify `expandCollection` (API + scrape fallback)                | T21.1        |
| T21.4 | YouTube playlist `parseUrl` + `expandCollection`                  | T21.1        |
| T21.5 | Parent/child grouping+collapse rendering, collection-aware cells  | T21.1, T21.2 |
| T21.6 | Collection contextual actions (start/restart/refetch/collapse/live/delete/select) | T21.2 |
| T21.7 | Live refresh scheduler + global/per-playlist settings             | T21.2        |
| T21.8 | Session naming/search for collections                             | T21.1        |
| T21.9 | Unit + TUI-harness coverage                                       | T21.1–T21.8  |
