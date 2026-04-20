# Tech Stack

## Runtime & Build

| Tool | Version | Role |
|------|---------|------|
| Node.js | — | Runtime |
| TypeScript | ^5.9.3 | Language (strict mode, ES2022 target) |
| tsx | ^4.20.6 | Dev runner (`npm run dev` → `tsx src/index.tsx`) |
| ts-node | ^10.9.2 | Listed in scripts but points to a non-existent `src/index.ts` |
| tsc | — | Build only (`npm run build` → `dist/`) |

The package is declared as an ES module (`"type": "module"`). There is no bundler — the app runs directly from source via `tsx`.

## UI Framework

| Package | Version | Role |
|---------|---------|------|
| ink | ^6.5.1 | React renderer for terminal (TTY) output |
| react | ^19.2.0 | Component model |
| ink-text-input | ^6.0.0 | Text input widget |
| ink-select-input | ^6.2.0 | Dropdown/list widget |
| ink-spinner | ^5.0.0 | Animated spinner |
| ink-big-text | ^2.0.0 | Large ASCII text |
| ink-gradient | ^3.0.0 | Gradient text |
| ink-picture | ^1.3.3 | Image rendering in terminal |
| ink-link | ^5.0.0 | Clickable hyperlinks |
| ink-form | ^2.0.1 | Form widget |
| fullscreen-ink | ^0.1.0 | Fullscreen terminal helper |

## Metadata Providers

| Package | Version | Role |
|---------|---------|------|
| @spotify/web-api-ts-sdk | ^1.2.0 | Spotify Web API client |
| ytmusic-api | ^5.3.1 | YouTube Music (unofficial, no auth) |
| musicbrainz-api | ^0.25.1 | MusicBrainz open database |

Song.link is queried via a custom HTTP client (`src/flows/musicDownloadFlow/services/apis/songlink-client.ts`) with no third-party SDK.

## Download Providers

| Package | Version | Role |
|---------|---------|------|
| ytdlp-nodejs | ^2.3.5 | Node.js wrapper for the yt-dlp binary |
| slsk-client | ^1.1.0 | Soulseek P2P client |

The yt-dlp and FFmpeg binaries are auto-downloaded from GitHub at first run (`src/utils/ytdlp-setup.ts`, `src/utils/ffmpeg-setup.ts`) and stored in `bin/`.

## File & Audio Processing

| Package | Version | Role |
|---------|---------|------|
| flac-tagger | ^1.0.7 | Write Vorbis Comments to FLAC files |
| node-id3 | ^0.2.9 | Remove invalid ID3 tags from FLAC before tagging |
| adm-zip | ^0.5.16 | Unzip downloaded binaries (FFmpeg) |
| sound-play | ^1.1.0 | Audio playback |

## Utilities

| Package | Version | Role |
|---------|---------|------|
| dotenv | ^17.2.3 | Load `.env` file |
| flat-cache | ^6.1.18 | Persistent disk cache for API responses |
| string-similarity | ^4.0.4 | Fuzzy string matching (used in Soulseek result scoring) |
| spotify-uri | ^4.1.0 | Parse Spotify URIs and URLs |
| open | ^11.0.0 | Open URLs or files in default system apps |
| chalk | 4 | Terminal color strings |
| winston | ^3.18.3 | Structured logging |
| winston-transport | ^4.9.0 | Custom Winston transport base class |

## Environment Variables

Loaded from `.env` by dotenv. The `Env` class (`src/base/env.ts`) can interactively prompt the user for any missing variable and persist the answer back to `.env`.

| Variable | Used by |
|----------|---------|
| `SPOTIFY_CLIENT_ID` | SpotifyService |
| `SPOTIFY_CLIENT_SECRET` | SpotifyService |
| `SOULSEEK_USERNAME` | SoulseekService |
| `SOULSEEK_PASSWORD` | SoulseekService |
