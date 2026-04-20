# MusicDownloadFlow

The only active flow. Implemented in `src/flows/musicDownloadFlow/`.

## Overview

`MusicDownloadFlow` extends `FlowBase` and is a singleton (`MusicDownloadFlow.getInstance(...)`). It owns two service registries:

**Metadata registry** (currently registered):
- `'spotify'` → `SpotifyService`
- `'youtube'` → `YoutubeService`

**Download registry** (currently registered):
- `'ytdlp'` → `YtDlpService`

Commented out but fully implemented: `musicbrainz`, `songlink` (metadata), `soulseek` (download).

## Task Import

`MusicDownloadFlow.importTasks()` reads `inputs.txt` from the project root. Each non-empty, non-comment line becomes one `DownloadTask`. Tasks are created with sequential IDs (`item-0`, `item-1`, ...) and added to the orchestrator queue. Attempting to import again when tasks already exist throws because the orchestrator rejects duplicate IDs.

## Display Modes

The flow has two display modes toggled by keyboard input (`1` for metadata, `2` for download):

- **metadata** — shows columns for each registered metadata service
- **download** — shows columns for each registered download service

`getColumns()` dynamically builds the column list from the registries based on the active mode. The `url` column weight drops from 45 to 3 in download mode to give space to download columns. `notifyTaskSubscribers()` is called on mode change, which re-renders the UI.

## DownloadTask (`src/flows/musicDownloadFlow/utils/downloadTask.ts`)

`DownloadTask` extends `Task<MusicDownloadTaskAttributes>`. It receives the two service registries at construction time and creates a `ServiceScope` for each. Services are instantiated lazily on first use within that scope.

### Task Attributes (`MusicDownloadTaskAttributes`)

```typescript
{
  toTag?: boolean;
  toDownload?: boolean;
  userInput: UserInput;               // { type: 'url', url: string }
  metadataSources: TrackMetadata[];   // All discovered metadata sources
  downloadSources: TrackDownloadSource[];
}
```

### `start()` Execution Sequence

`DownloadTask.start()` runs three sequential async steps:

**1. `startPrimaryMetadataFetching()`**

Iterates registered metadata services. For each service, calls `service.getType(url)` to check if it can handle the URL. The first service that returns `'track'` calls `service.getTrackMetadata(url)`, marks the result `isPrimarySource = true`, and appends it to `metadataSources`. The loop stops after the first success.

**2. `startMetadataDiscovering()`**

Takes the primary metadata source and passes it to every other registered metadata service via `service.searchTrack(primaryMetadata)`. Each result (non-primary) is appended to `metadataSources`. Failures are logged as warnings and skipped — discovery continues to the next service.

**3. `startDownloads()`**

Iterates registered download services. For each, finds the first compatible metadata source via `downloadService.canDownload(metadata)`. Then calls `downloadService.downloadTrack(compatibleMetadata)`, which returns a `TrackDownloadSource`. All results are collected and written to `downloadSources` as a batch at the end.

Each `updateAttributes()` call inside these steps notifies all task subscribers, so the UI updates progressively as data arrives.

## Active Services

### SpotifyService (`services/metadata-providers/spotify.ts`)

- `getType(url)` — returns `'track'` if the URL contains `open.spotify.com/track/`
- `getTrackMetadata(url)` — extracts the Spotify track ID, calls the Spotify SDK, converts the result to `SpotifyTrackMetadata`
- `searchTrack(primaryMetadata)` — searches Spotify by track name + artist name, returns the best match as `SpotifyTrackMetadata`
- Uses `runExclusive('initialize', ...)` for SDK client initialization
- Requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`
- API responses are cached with the `@Cached` decorator

### YoutubeService (`services/metadata-providers/youtube.ts`)

- `getType(url)` — returns `'track'` if the URL contains `youtube.com` or `music.youtube.com`
- `getTrackMetadata(url)` — not the primary path for the current POC (Spotify URLs are used as input)
- `searchTrack(primaryMetadata)` — searches YouTube Music by track name + artist name, returns the best match as `YoutubeTrackMetadata`
- Uses the `ytmusic-api` package (unofficial, no authentication)
- API responses are cached with the `@Cached` decorator

### YtDlpService (`services/download-providers/ytdlp.ts`)

- `canDownload(metadata)` — returns `true` if `metadata.platform` is `'youtube'` or `'youtubeMusic'`
- `downloadTrack(metadata)` — calls the yt-dlp binary with the track URL, saves the file to `DOWNLOAD_DIR`, and returns a `TrackDownloadSource` with `localFile` populated
- Requires yt-dlp and FFmpeg binaries (auto-downloaded on first run)
- Uses `ytdlp-nodejs` wrapper
- Progress callbacks update `task.status` during download

## Caching (`src/utils/cache.ts`)

The `@Cached()` decorator wraps `async` methods. On first call, the result is stored in a flat-cache on disk with a 90-day TTL. Subsequent calls with the same arguments return the cached value without hitting the API. Cache is persisted every 2 minutes and at process exit.

Cache key format: `ClassName:methodName:JSON.stringify(args)`

## Domain Types (`src/flows/musicDownloadFlow/types.ts`)

`TrackMetadata` is a discriminated union of platform-specific types:

```
TrackMetadata =
  | SpotifyTrackMetadata    (platform: 'spotify')
  | YoutubeTrackMetadata    (platform: 'youtube')
  | YoutubeMusicTrackMetadata (platform: 'youtubeMusic')
  | MusicBrainzTrackMetadata (platform: 'musicBrainz')
  | DeezerTrackMetadata
  | AppleMusicTrackMetadata
  | SoundcloudTrackMetadata
  | TidalTrackMetadata
```

All share `BaseTrackMetadata` fields: `id`, `isrc`, `trackName`, `duration` (ms), `trackNumber`, `url`, `uri` (typed as `"PLATFORM::TRACK::id"`), `artists`, `album`, `platform`, `apiProvider`, `isPrimarySource`, `fetchedAt`, `type: 'track'`.

`TrackDownloadSource` represents one download attempt:

```typescript
{
  state: 'pending' | 'searching' | 'downloading' | 'downloaded' | 'failed';
  provider: 'ytdlp' | 'soulseek';
  track: TrackMetadata;       // the metadata used to find the download
  localFile?: {
    state: 'found' | 'not_found';
    path: string;
    name: string;
    extension: 'flac';
    sourceUrl?: string;
  };
  downloadedAt: Date;
  selected: boolean;
}
```

## Contextual Actions

`getContextualActionBar(task, { columnIndex })` returns keyboard shortcuts that change depending on which column is focused:

- Any column: `r` → start this task
- `toTag` column: `Space` / `Enter` → toggle `toTag`
- `toDownload` column: `Space` / `Enter` → toggle `toDownload`
- `metadataService-*` columns: `s` → search (handler is currently empty)

## Toolbar Buttons

`getToolbarButtons()` returns four hooks:

1. `useImportButton` — calls `flow.importTasks()`
2. `useRunAllButton` — calls `flow.runAll()` → `orchestrator.processTasks()`
3. Settings (inline) — label only, no handler implemented
4. `useExitButton` — calls `process.exit(0)`
