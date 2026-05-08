# Claude Code — Project Context

## Quick orientation

- **What this is:** A keyboard-driven terminal UI (Ink/React) for downloading and tagging music tracks from streaming platforms.
- **Current state:** Working POC for one pipeline — Spotify URL → YouTube search → yt-dlp download.
  - Run the local script [TREE.ps1](TREE.ps1) to get the full project tree
- **Target state:** See [README.md](README.md) and [docs/designs/](docs/designs/) (screenshots contain the most detail).

## Key documents

- [docs/audit/README.md](docs/audit/README.md) — Codebase audit: architecture, data flow, file structure, what's active vs. disabled. Read this before exploring the codebase.
- [docs/projects/README.md](docs/projects/README.md) — High-level technical projects needed to reach the target product.

## Provider extensibility

Adding a new provider should require changes in only two places:

1. A new service class file (the implementation)
2. One `.register(MyService)` call in `MusicDownloadFlow`'s constructor

Display metadata (label, color, acronym, color variants) must **not** be hardcoded in components. Each service class declares `static readonly display: ProviderDisplay`. `ServiceRegistry.register()` reads it automatically and calls `providerDisplayRegistry.register()`. Components call `providerDisplayRegistry.get(key)` for display info.

Unregistered API platforms (youtubeMusic, deezer, appleMusic, etc.) that appear in `TrackMetadata.apiProvider` from external APIs have built-in defaults pre-loaded in `src/base/providerDisplay.ts`.

## Active vs. disabled code

Only two metadata services are registered: `spotify` and `youtube`. Only one download service is registered: `ytdlp`. MusicBrainz, Song.link, and Soulseek are implemented but commented out in `src/flows/musicDownloadFlow/musicDownloadFlow.ts`.

## Dev commands

```
npm run dev   # run with tsx (use this)
```

Entry point: `src/index.tsx`.
