# Architecture

A short map of how Goblin Malin is put together. It deliberately stays at the level of "which folder does what" so that it doesn't go stale: for the exact file list run [scripts/TREE.ps1](../scripts/TREE.ps1), for the roadmap see [docs/projects/](projects/README.md), and for the rules that every change must follow see [CLAUDE.md](../CLAUDE.md).

## What it is

A keyboard-driven terminal UI (Ink / React) that turns streaming-platform links into tagged audio files:

```
import URL ──► primary metadata ──► discovery on other platforms ──► download sources ──► pick one ──► tag + save
(Spotify,      (Spotify /           (Songlink*, MusicBrainz,        (yt-dlp, Soulseek)                (tagged file in
 YouTube,       YouTube)             Claude*, last resort)                                             output folder)
 albums,                                                          * opt-in, asks once
 playlists)
```

## Entry points

| File                                                                          | Role                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/cli.ts](../src/cli.ts)                                                   | The `goblin-malin` binary.                                                                                                                                             |
| [src/index.tsx](../src/index.tsx)                                             | `start()`: takes the single-instance lock, calls `initMusicApp()`, installs crash/signal handlers (they restore the terminal and save), renders `<App />` full screen. |
| [src/flows/musicDownloadFlow/init.ts](../src/flows/musicDownloadFlow/init.ts) | `initMusicApp()`: **the one place where providers are registered**, then applies the concurrency settings and starts the live-playlist refresh scheduler.              |

## Layers

- **`src/base/`** — generic infrastructure that knows nothing about music: the task engine (`task/`: `Task`, `TaskOrchestrator`, statuses, prompts), the service registry and `ServiceBase`, provider display metadata, the shortcut registry, mouse handling, the logger, theme, and the _bridges_ (small singletons that let non-React code open a React modal: consent, overwrite confirm, binary-not-found alert, a generic confirm / pick-from-list dialog, …).
- **`src/flows/musicDownloadFlow/`** — everything music-specific. Despite the folder name there is no "flow" abstraction any more (it was removed, see [P20b](projects/p20b/tasks.md)); this folder is simply the product.
    - `types.ts` — the data model (`TrackMetadata`, `TrackDownloadTask`, `TrackDownloadSource`, …).
    - `utils/downloadTask.ts` — `DownloadTask`, the heart of the pipeline for one track (see below). `utils/collectionTask.ts` — `CollectionTask`, an album/playlist parent that expands into child `DownloadTask`s.
    - `taskFactory.ts`, `runController.ts` — create tasks from URLs or saved snapshots; Run all / Run selected / Stop.
    - `services/` — the providers (below).
    - `columns/`, `contextualActions.ts`, `taskColumns.ts`, `settings.ts`, `buildFlowSettingsItems.ts` — what the task list shows, which actions each row offers, and the matching Settings rows.
- **`src/components/`** — Ink UI: the task list, the secondary panel (metadata / download sources / logs), modals (import, settings, sessions, archive, start, update, welcome tour, …), the toolbar and the hint bars.
- **`src/hooks/`, `src/contexts/`** — focus management, shortcut registration (`useShortcuts`), settings and task subscriptions.
- **`src/sessions/`, `src/settings/`, `src/utils/`** — persistence (`sessions.json`, archive, `settings.json`, both versioned with a `.bak`), the app-data-dir helpers, tool downloads (yt-dlp, ffmpeg, ffprobe, mpv), tagging, caching, HTTP.
- **`src/updater/`** — the update check and the installer detection used by the self-update.
- **`src/profiling/`** — the render-profiling entry used by the TUI harness (`--profile`).

## The task pipeline

`TaskOrchestrator` is a generic, completion-driven queue under a global concurrency cap (`maxParallelTasks`). It only calls `task.start(signal)`. A `DownloadTask` then runs three stages, with two limiters (`utils/stageLimiters.ts`): metadata and discovery share `maxParallelMetadata`, downloads use `maxParallelDownloads`:

1. **Primary metadata** — the service whose `parseUrl()` recognised the URL fetches the track.
2. **Discovery** — look for the same track on the other platforms (ISRC or name match). Services marked `lastResort` only run if a platform is still missing, and their results must pass the platform's own metadata fetch plus a confidence check ([utils/confidence.ts](../src/flows/musicDownloadFlow/utils/confidence.ts)). The compiled metadata merges all sources and the user's overrides.
3. **Download sources** — every enabled download service searches or resolves candidates; the best one is auto-selected ([utils/sourceSelection.ts](../src/flows/musicDownloadFlow/utils/sourceSelection.ts)) and the user can preview and change it. Saving tags the file and moves it to the output folder.

Links the user pastes onto a track (the source the search could not find) are kept in `userSources` and re-applied whenever the sources are rebuilt (P31); the track's own link (`userInput`) and those are the user's data, not the pipeline's.

Discovery ends with a fourth step (P30): **which MusicBrainz release is this track on?** `DownloadTask.checkMusicBrainz()` asks MusicBrainz by album barcode, streaming link, ISRC and title + artist, and a pure resolver ([musicbrainz/resolveIdentity.ts](../src/flows/musicDownloadFlow/musicbrainz/resolveIdentity.ts)) turns the answers into a verdict stored on the task (`musicBrainzIdentity`): matched only on conclusive evidence, otherwise a review for the user. The matched IDs go into the saved file's tags; a release that is truly missing can be added through the user's own browser. See [P30](projects/p30/tasks.md).

A task is a plain serialisable attribute object (`TrackDownloadTask`) plus a status; the whole task list is saved as a session after changes and revived by `createTasksFromSnapshots()`.

## Providers (the extensibility axis)

Three registries, defined in [registries.ts](../src/flows/musicDownloadFlow/registries.ts):

| Registry                   | Base class                                                                             | Registered today                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `metadataServiceRegistry`  | [MetadataService](../src/flows/musicDownloadFlow/metadataService.ts)                   | `spotify`, `youtube`                                               |
| `discoveryServiceRegistry` | [DiscoveryMetadataService](../src/flows/musicDownloadFlow/discoveryMetadataService.ts) | `songlink` (opt-in), `musicBrainz`, `claude` (opt-in, last resort) |
| `downloadServiceRegistry`  | [DownloadService](../src/flows/musicDownloadFlow/downloadService.ts)                   | `ytdlp`, `soulseek`                                                |

Adding a provider = one service class + one `register()` call in `init.ts`. Display info (`static display`), settings (`defaultSettings`), consent, last-resort, URL parsing and its cell component are all declared on the class and read generically, so the UI and the pipeline never branch on a provider key. The details of these static capabilities are in [CLAUDE.md](../CLAUDE.md#provider-extensibility).

## Data on disk

Everything lives in one folder (`GOBLIN_DATA_DIR`, else the OS default; `<repo>/data` when running from source): `settings.json`, `sessions.json` (+ `.bak`), `.env` (credentials), `cache/`, `bin/` (downloaded tools, `cookies.txt`), `app.log` (+ `app.prev.log`). The folder is derived at start-up and never read back from `settings.json` ([utils/appPaths.ts](../src/utils/appPaths.ts)). A lock file keeps a second instance out of the same folder.

## Input and hints

All keys go through `ShortcutDispatcher` and the `ShortcutRegistry`: components register shortcuts with `useShortcuts` (never `useInput`), users can rebind any of them, and on-screen hints resolve the live binding by shortcut id (`Hint`, `DynamicHintBar`). See the "Shortcuts & hints" section of [CLAUDE.md](../CLAUDE.md).

## Tests

- `tests/unit/` — Vitest unit tests (`yarn test`, `yarn test:coverage`).
- `tests/e2e/` — end-to-end tests that drive the real app through the headless TUI harness.
- [scripts/tui-test/](../scripts/tui-test/README.md) — the harness itself (JSON scenarios, screenshots, render profiling). Each run works on a throwaway copy of its fixture data.
