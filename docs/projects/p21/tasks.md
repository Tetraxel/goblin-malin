# P21 — Playlist & Album Import: Tasks

## Context

**The single biggest workflow multiplier the app is missing.** Users organize music in playlists and buy/track albums — importing one playlist should import 50 tracks. Today it imports zero:

- `detectUrls()` ([detectUrls.ts](../../../src/components/ImportModal/detectUrls.ts)) keeps every URL, and `SpotifyService.parseUrl` already recognizes `type: "album" | "playlist"` (`ParsedUrl` in [urlParser.ts](../../../src/base/urlParser.ts) has carried these types since P15).
- But `resolveTrackRecognition()` ([resolveTrackRecognition.ts](../../../src/flows/musicDownloadFlow/utils/resolveTrackRecognition.ts)) only returns a recognition when `parsed.type === "track" && parsed.id`. A pasted playlist URL therefore becomes a permanently-"Unknown" task that can never fetch anything — worse than an error, it looks broken.
- TODO.md lists "Handle Spotify albums/playlists as input" as nice-to-have; this plan argues it is the highest-leverage user feature on the board.

**Design principle** (per the provider-extensibility philosophy): collection expansion is a per-service capability declared on the service class — no hardcoded platform logic in the import modal or the flow.

---

## Tasks

### T21.1 — `CollectionExpansion` contract + registry resolver

Add to `MetadataService` ([metadataService.ts](../../../src/flows/musicDownloadFlow/metadataService.ts)) an optional static, mirroring `parseUrl`:

```typescript
export type CollectionExpansion = {
    kind: "album" | "playlist";
    name: string;               // "Discover Weekly", "Presence"
    ownerName?: string;         // playlist owner / album artist
    trackUrls: string[];        // canonical track URLs, importable as-is
    totalCount: number;         // may exceed trackUrls.length if capped
    truncated?: boolean;
};

// On MetadataService (optional — services opt in):
static expandCollection?(url: string, logger: Logger): Promise<CollectionExpansion>;
```

Add `resolveCollectionExpansion(url, registry)` next to `resolveTrackRecognition` — walks `registry.getAllConstructors()`, returns the first service whose `parseUrl` yields `type: "album" | "playlist"` **and** which implements `expandCollection`, plus the parsed result. Single source of truth for "URL → collection".

_Depends on: nothing_

---

### T21.2 — Spotify expansion (albums + playlists)

Implement `SpotifyService.expandCollection`:

- **API mode** (`@spotify/web-api-ts-sdk`, already a dependency): `playlists.getPlaylistItems(id)` / `albums.tracks(id)` with pagination (100/50 per page) until `totalCount`. Map each item to `https://open.spotify.com/track/{id}`.
- **Scrape mode** (P14 no-auth fallback via `spotify-url-info`): returns limited embedded items — expand what's available, set `truncated: true` and surface that in the modal (T21.4) with a hint to configure API credentials.
- Skip playlist-local files (`item.is_local`) and episode items; count them in a `skipped` note in the log.
- Respect the existing `@Cached()` conventions used by other Spotify calls.

_Depends on: T21.1_

---

### T21.3 — YouTube expansion (playlists; albums are playlists on YT)

Implement `YoutubeService.expandCollection`:

- `parseUrl` support for `youtube.com/playlist?list=…` and `music.youtube.com/playlist?list=…` (and `?list=` on watch URLs → offer the playlist, T21.4 shows both options).
- Fetch via `ytmusic-api` (already a dependency) `getPlaylist` / `getAlbum`; fallback: `yt-dlp --flat-playlist -J` through `ytdlp-nodejs` (no extra binary — it's the same yt-dlp already required for downloads). Map entries to `https://music.youtube.com/watch?v={id}`.

_Depends on: T21.1_

---

### T21.4 — Import modal UX for collections

In [ImportModal](../../../src/components/ImportModal/ImportModal.tsx) / [useImportFlow.ts](../../../src/components/ImportModal/useImportFlow.ts):

- When a detected URL resolves as a collection, render a **group header row** instead of a plain URL row: `▸ Playlist "Running 2026" — fetching…` with the shared spinner cadence, then `▸ Playlist "Running 2026" — 42 tracks` once expanded. Expansion starts immediately on detection (before confirm) so the user sees the count.
- `[Space]` on the header toggles include/exclude of the whole collection; expanded child rows are listed indented under the header (first N with `… +32 more`).
- **Cap**: default `import.maxCollectionTracks = 500` (app setting). Beyond the cap: import the first 500, mark `truncated`, show a warning line. Prevents a pasted "Top 10000" playlist from freezing the session.
- Failure state: header row shows `✗ could not expand (…reason)` with the raw URL still importable as a single Unknown task (current behavior preserved).
- A watch-URL with `&list=` shows a one-line choice: import the single track or the playlist.

_Depends on: T21.2 or T21.3 (at least one expander to demo)_

---

### T21.5 — Import-group provenance on tasks & sessions

- Add `importGroup?: { id: string; name: string; sourceUrl: string; kind: "album" | "playlist" }` to `MusicDownloadTaskAttributes` ([types.ts](../../../src/flows/musicDownloadFlow/types.ts)). `createTasksFromUrls` gains an optional `importGroup` argument.
- Task list: the URL cell hint (contextual action bar) shows the group name; add a contextual action "Select all from this import" (uses the existing multi-select mechanism).
- Sessions: a fresh draft session that receives a collection import is auto-named after the collection (`sessionManager` already derives names from the first task — extend the derivation to prefer `importGroup.name`).

_Depends on: T21.1, T21.4_

---

### T21.6 — Politeness & scale

- Expansion calls go through the **metadata stage limiter** ([stageLimiters.ts](../../../src/flows/musicDownloadFlow/utils/stageLimiters.ts)) so a 500-track expansion can't starve interactive fetches.
- `orchestrator.addTasks()` in chunks (e.g. 50/frame via the notification scheduler) so the task list stays responsive while hundreds of rows appear — P20's event-driven orchestrator makes this cheap; verify with the profiler that a 500-task import stays within the P18 anomaly budgets.

_Depends on: T21.4_

---

### T21.7 — Tests

- Unit: `resolveCollectionExpansion` recognition matrix; Spotify/YouTube mappers against recorded API fixtures (no network); cap/truncation logic.
- TUI harness: scenario "paste playlist URL → header expands → confirm → N tasks in list" using a fixture service; add to the vitest e2e suite.

_Depends on: T21.1–T21.6_

---

## Summary

| Task  | What                                                             | Depends on   |
| ----- | ---------------------------------------------------------------- | ------------ |
| T21.1 | `CollectionExpansion` contract + `resolveCollectionExpansion()`  | —            |
| T21.2 | Spotify album/playlist expansion (API + scrape fallback)         | T21.1        |
| T21.3 | YouTube playlist expansion (ytmusic-api / yt-dlp flat-playlist)  | T21.1        |
| T21.4 | Import modal group rows, toggles, cap, failure states            | T21.2/T21.3  |
| T21.5 | `importGroup` provenance on tasks + session auto-naming          | T21.1, T21.4 |
| T21.6 | Stage-limiter politeness + chunked task insertion                | T21.4        |
| T21.7 | Unit + TUI-harness coverage                                      | T21.1–T21.6  |
