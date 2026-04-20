# Project Structure

## Top-Level Layout

```
goblin-malin/
├── src/                        # All active source code
├── @types/                     # Manual type declarations
│   └── slsk-client/index.d.ts  # Types for the slsk-client package (missing upstream)
├── docs/
│   ├── designs/                # UI mockup screenshots (PNGs)
│   └── audit/                  # This audit
├── samples/                    # Saved API response examples (JSON)
├── cache/                      # Runtime API cache (flat-cache, git-ignored)
├── bin/                        # Auto-downloaded yt-dlp and FFmpeg binaries
├── downloads/                  # Downloaded audio files (default output)
├── inputs.txt                  # Task input file (one URL per line)
├── app.log                     # Application log (JSON, written by Winston)
├── .env                        # Environment variables (not committed)
├── package.json
└── tsconfig.json
```

## Source Tree (`src/`)

```
src/
├── index.tsx                   # App entry point
├── constants.ts                # Global path constants (PROJECT_ROOT, DOWNLOAD_DIR, BIN_DIR)
├── reducer.ts                  # Unused Redux-style reducer (not wired into the app)
│
├── base/                       # Framework layer — generic, flow-agnostic
│   ├── env.ts                  # Env variable loader with interactive prompts
│   ├── service-base.ts         # Abstract base for all services
│   ├── service-registry.ts     # Registry mapping service keys to factory functions
│   ├── service-scope.ts        # Instantiates services lazily per-task from a registry
│   └── logger/
│       ├── logger.ts           # Winston logger + globalLogger singleton + child logger factory
│       ├── ink-transport.ts    # Custom Winston transport that pushes logs to React state
│       └── types.ts            # Log metadata types (service, task, flow)
│   └── task/
│       ├── task.ts             # Base Task class with attributes, status, prompt, subscribers
│       ├── task-status.ts      # TaskStatus with StatusType enum and subscriber notifications
│       └── task-prompt.ts      # TaskPrompt — handles interactive user prompts inside tasks
│   └── flow/
│       ├── flow-base.ts        # Abstract FlowBase with subscriber notifications
│       └── flow-orchestrator.ts # Singleton that manages flows, the task queue, and concurrency
│
├── components/                 # Ink/React UI components
│   ├── App.tsx                 # Root component — initializes flows, wires orchestrator, renders layout
│   ├── Toolbar.tsx             # Top bar with action buttons
│   ├── TaskListPanel.tsx       # Scrollable table of tasks with dynamic column layout
│   ├── TaskRow.tsx             # Single task row
│   ├── PromptModal.tsx         # Centered overlay for user prompts
│   ├── LogPanel.tsx            # Scrollable log output panel
│   ├── Footer.tsx              # Bottom status/help bar
│   ├── Separator.tsx           # Horizontal line separator
│   ├── FlowSelector.tsx        # Flow switcher widget
│   ├── AnimatedIcon.tsx        # Spinner/animated icon
│   ├── FullScreenBox.tsx       # Wrapper for fullscreen rendering (not used in current entry)
│   └── ToolbarButtonInvoker.tsx # Renders and handles a single toolbar button
│
├── contexts/
│   └── FocusContext.tsx        # React context that shares global focus/navigation state
│
├── hooks/
│   ├── useTask.ts              # Subscribe to a task and re-render on changes
│   ├── useFocusManager.ts      # Tab/arrow navigation state across windows
│   ├── useGlobalTicker.ts      # Re-renders on a timer interval
│   ├── useScreenSize.ts        # Terminal width/height from process.stdout
│   └── useActivePrompt.ts      # Finds which task currently has an active prompt
│
├── utils/
│   ├── cache.ts                # @Cached decorator — caches async method results to disk
│   ├── metadata.ts             # FLAC tag writing + ID3 cleanup
│   ├── json.ts                 # Read/write JSON files
│   ├── string.ts               # replaceAll helper
│   ├── sleep.ts                # Promise-based sleep
│   ├── ffmpeg-setup.ts         # Auto-download FFmpeg binary
│   ├── ytdlp-setup.ts          # Auto-download yt-dlp binary
│   └── useWhyDidYouUpdate.ts   # React dev hook to log prop changes causing re-renders
│
├── exceptions/
│   └── EnvironmentError.ts     # Custom error thrown when a required env var is missing
│
└── flows/
    └── musicDownloadFlow/      # The only active flow
        ├── musicDownloadFlow.ts    # MusicDownloadFlow class (singleton)
        ├── types.ts                # All domain types for this flow
        ├── metadataService.ts      # Abstract MetadataService (getTrackMetadata, searchTrack, getType)
        ├── downloadService.ts      # Abstract DownloadService (canDownload, downloadTrack)
        │
        ├── columns/                # Column cell components for the task table
        │   ├── UrlCell.tsx
        │   ├── ArtistCell.tsx
        │   ├── TrackCell.tsx
        │   ├── StatusCell.tsx
        │   ├── ToTagCell.tsx
        │   ├── ToDownloadCell.tsx
        │   └── providers/
        │       ├── SpotifyCell.tsx
        │       ├── YoutubeCell.tsx
        │       ├── YtDlpCell.tsx
        │       └── MbCell.tsx      # MusicBrainz cell (not active)
        │
        ├── services/
        │   ├── metadata-providers/
        │   │   ├── spotify.ts      # SpotifyService — active
        │   │   ├── youtube.ts      # YoutubeService — active
        │   │   ├── musicbrainz.ts  # MusicBrainzService — implemented, not registered
        │   │   └── songlink.ts     # SonglinkService — implemented, not registered
        │   ├── download-providers/
        │   │   ├── ytdlp.ts        # YtDlpService — active
        │   │   └── soulseek.ts     # SoulseekService — implemented, not registered
        │   └── apis/
        │       └── songlink-client.ts  # Raw HTTP client for the Song.link API
        │
        ├── toolbar/
        │   ├── useImportButton.ts  # Hook: "Import" button — reads inputs.txt
        │   ├── useRunAllButton.ts  # Hook: "Run All" button — starts all tasks
        │   └── useExitButton.ts    # Hook: "Exit" button — exits the process
        │
        └── utils/
            ├── downloadTask.ts         # DownloadTask — the concrete Task subclass for this flow
            ├── input-loader.ts         # InputLoader — reads inputs.txt (singleton)
            └── convertSonglinkToTrack.ts # Converts a Song.link API response to TrackMetadata
```

## Files That Are Not Part of the Active App

- `index.ts` (root) — old CLI entry point, contains only commented-out code
- `src/reducer.ts` — Redux-style reducer defined but not imported anywhere
- `src/components/FullScreenBox.tsx` — imported in `index.tsx` but the `withFullScreen` call is commented out; `render(<App />)` is used instead
- All commented-out service registrations in `musicDownloadFlow.ts` (MusicBrainz, Song.link, Soulseek)
- Old implementation methods at the bottom of `downloadTask.ts` (`fetchTrackMetadata`, `downloadTrack`, `fetchMusicBrainz`) — present but unreachable from `start()`
