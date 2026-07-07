# P28 — Provider Expansion: Deezer & SoundCloud: Tasks

## Context

The target README promises imports from *"Spotify, SoundCloud, YouTube, YouTube Music, Deezer, Apple Music, Tidal"* — today only Spotify and YouTube are registered. This project adds the two providers with the best effort-to-value ratio, and doubles as the **first real test of the extensibility philosophy** ("a new provider = one service class + one `.register()` call") by someone-shaped-like-a-contributor:

- **Deezer** has a free, keyless public API (`api.deezer.com`): track by ID, text search, and — uniquely — **lookup by ISRC** (`/track/isrc:{isrc}`) plus **BPM and gain fields** in track responses. The metadata screen already displays BPM/Key columns that are chronically empty; Deezer fills them for free. No wizard, no auth, no rate-limit drama at this app's volumes.
- **SoundCloud** link handling is a TODO release-backlog item. SoundCloud closed public API signups, but yt-dlp extracts SoundCloud metadata *and* audio natively — and SoundCloud is the one mainstream platform where some artists offer **original-quality lossless** downloads, which P22's provenance layer can label honestly.
- `providerDisplay.ts` already ships built-in display defaults for `deezer` and `soundcloud` (colors/acronyms), so cross-referenced results from these platforms already render — registration makes them first-class.

Apple Music/Tidal are intentionally out of scope (no viable free API; revisit on demand).

---

## Tasks

### T28.1 — `DeezerService` (metadata provider)

`src/flows/musicDownloadFlow/services/metadata-providers/deezer/DeezerService.ts`:

- `static display` (align with the built-in defaults), `static defaultSettings` (just `enabled`), `static parseUrl` for `deezer.com/(xx/)?track/{id}` and `link.deezer.com` short links (resolve via HEAD redirect).
- `getTrackMetadata(url)`: `GET /track/{id}` → map to `TrackMetadata` (title, artists, album, duration, ISRC, **bpm**, **gain**, release date, cover, link). `@Cached()` like the other services.
- `searchTrack(seed)`: `GET /search?q=artist:"…" track:"…"` → `SearchTrackResult[]` with the shared confidence scoring.
- Register: `this.metadataServiceRegistry.register("deezer", DeezerService)` — **the only core-file line**. Track any place that unexpectedly needs a third change as an extensibility bug and fix the registry/registration path, not the call-site.

_Depends on: nothing_

---

### T28.2 — Deezer discovery provider (ISRC fast path)

`DeezerDiscoveryService` (a `DiscoveryMetadataService`, [discoveryMetadataService.ts](../../../src/flows/musicDownloadFlow/discoveryMetadataService.ts)):

- `discoverFromUri(sourceMetadata)`: when the source has an ISRC → `GET /track/isrc:{isrc}` (exact, one request); else fall back to text search + confidence gate.
- Discovery results enrich the metadata pool with Deezer's BPM/gain, feeding the Compiled Metadata row's BPM field — the concrete user win: **BPM appears for most mainstream tracks without any manual work**.
- Register in `discoveryServiceRegistry`; column, settings row, and panel grouping must appear automatically (same registry-driven UI as Songlink/MusicBrainz).

_Depends on: T28.1 (shares the API client)_

---

### T28.3 — `SoundCloudService` (metadata provider)

`src/flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService.ts`:

- `static parseUrl` for `soundcloud.com/{user}/{track}` (exclude `/sets/` for now — that's a P21 collection kind to add later) and `on.soundcloud.com` short links.
- `getTrackMetadata(url)`: `yt-dlp -J <url>` via `ytdlp-nodejs` (no API key needed; yt-dlp's SoundCloud extractor is maintained) → map title/uploader/duration/artwork/genre. Parse `Artist - Title` out of the SoundCloud title when the uploader is a label/channel — reuse the P26/T26.2 line parser if it has landed, else a minimal local split.
- `searchTrack(seed)`: `yt-dlp -J "scsearch5:{artist} {title}"` → ranked results. Both calls run under the metadata stage limiter and `@Cached()`.

_Depends on: nothing (better with P26/T26.2)_

---

### T28.4 — SoundCloud download path

- Add `"soundcloud"` to [YtDlpService](../../../src/flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService.ts).`compatibleMetadataProviders` and teach `downloadTrack` to download the metadata source's own URL directly when its platform is SoundCloud (instead of running a YouTube search for a track that already has a direct source).
- Format honesty (with P22/T22.5): request best audio; when SoundCloud serves original lossless (some artists enable it) the probe labels it `lossless` — otherwise the transcode is labeled like YouTube's. Without P22, keep current FLAC behavior; the probe work is not duplicated here.

_Depends on: T28.3; provenance labels need P22/T22.5_

---

### T28.5 — Extensibility audit write-up

After T28.1–T28.4, record in this folder (`extensibility-report.md`) every file that had to change beyond *service class + register line*, and fix the generic path where feasible (e.g. if column min-widths, URI parsing, or contextual actions needed provider-specific edits). This is the cheapest moment to harden the plugin story the CLAUDE.md philosophy demands — with two fresh data points instead of zero.

_Depends on: T28.1–T28.4_

---

### T28.6 — Tests

- Unit: `parseUrl` matrices (locale paths, short links); Deezer/SoundCloud response mappers against recorded JSON fixtures; ISRC fast-path vs text fallback.
- TUI harness: import a Deezer URL scenario (fixture client) → metadata row with BPM populated; SoundCloud URL → download source appears.

_Depends on: T28.1–T28.4_

---

## Summary

| Task  | What                                                       | Depends on      |
| ----- | ----------------------------------------------------------- | --------------- |
| T28.1 | `DeezerService` metadata provider (keyless API, BPM/ISRC)   | —               |
| T28.2 | Deezer discovery via ISRC fast path → BPM enrichment        | T28.1           |
| T28.3 | `SoundCloudService` metadata via yt-dlp extraction          | —               |
| T28.4 | Direct SoundCloud downloads through `YtDlpService`          | T28.3           |
| T28.5 | Extensibility audit + registry hardening                    | T28.1–T28.4     |
| T28.6 | Fixture-based unit tests + TUI scenarios                    | T28.1–T28.4     |
