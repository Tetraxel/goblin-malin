# goblin-malin

A keyboard-driven terminal UI for downloading and tagging music tracks with high-quality metadata. Import links from Spotify, SoundCloud, YouTube, YouTube Music, Deezer, Apple Music, or Tidal — the app cross-references metadata across providers, finds the best audio source (via yt-dlp or Soulseek), and saves it to disk with clean tags.

> **Developers:** see [docs/audit/](docs/audit/%23README.md) for a codebase audit and [docs/projects/](docs/projects/%23README.md) for the roadmap of technical projects.

## Steps

- Import track URLs from compatible streaming platforms (Spotify, SoundCloud, YouTube, YouTube Music, Deezer, Apple Music, Tidal)
- System fetches primary metadata from the corresponding URL platform
- System discovers the same track on other platforms (cross-referencing via ISRC or track/artist name)
- User filters/orders metadata sources by relevance (or leaves the default ranking chosen by the system)
- System downloads matching tracks from available download providers (yt-dlp, Soulseek)
- User selects the best download source and previews the audio
- User saves the file to the desired folder with embedded tags

## Import modal

<img src="docs\designs\import-modal.png"/>

Press `CTRL+V` to paste links from the clipboard. A confirmation modal lists all detected URLs before importing. Press `[ENTER]` to confirm or `[Esc]` to cancel.

Supported URL formats include `open.spotify.com`, `soundcloud.com`, `music.youtube.com`, and `youtube.com`.

## Settings modal

<img src="docs\designs\settings-modal.png"/>

Settings are split into two sections:

**Metadata** — configure which providers are queried (Spotify, Deezer, Apple Music, Tidal, YouTube, SoundCloud, MusicBrainz). MusicBrainz-specific options include importing files into Picard on save and including MusicBrainz IDs in the embedded tags by default.

**Download** — configure download providers (yt-dlp and Soulseek), set the default output directory, toggle auto-save and auto-deletion of temporary downloads after 24 hours, and auto-relocation of missing files.

Press `[Ctrl+S]` to save and exit the settings.

## Metadata screen

<img src="docs\designs\metadata-screen.png"/>

The metadata screen lets the user select tasks (checkbox "TAG?") to process:

1. **Fetch primary metadata** — pulls metadata from the URL's native provider (e.g. Spotify API for a Spotify link)
2. **Discover other platforms** — cross-references the track on other enabled providers using reliable identifiers like ISRC, or fallback attributes like track title and artist name

Metadata fields include: Track Title, Artists, Duration, Album Name, Album Artists, Year, Track number, BPM, Key, Genres, and MusicBrainz IDs (track, album, artist, album artist, release group).

Once discovery is done, users can:

- **Favorite** a source to pin it as the preferred one for a given provider (max one per provider) — `[F]`
- **Reject** a source if the system matched the wrong track — `[Del]`
- **Reorder** sources to control which metadata takes priority — `[Shift+↑]` / `[Shift+↓]`

The **Compiled Metadata** row is a virtual aggregate that picks each field from the highest-ranked available source. It is the only editable row — the user can manually correct the track title or artist name if needed.

## Download screen

<img src="docs\designs\download-screen.png"/>

The download screen lets the user select tasks to download (checkbox "DL?"). The system searches each enabled download provider (yt-dlp, Soulseek) and downloads matching tracks to a temporary folder.

The right panel previews the selected file: format (e.g. FLAC), file size, duration with waveform scrubber, and all embedded metadata tags. Press `[Space]` to play a preview.

Once satisfied with the audio and metadata, press `[Enter]` to save the file to disk.

If the track was previously saved, the panel shows the current **file on disk** state:

<img src="docs\designs\downloads-window-file-previously-saved.png"/>

If the user changes the download source or any metadata field, a **diff** is shown side by side — old version on the left, new version on the right — before confirming the update:

<img src="docs\designs\downloads-window-change-download-source.png"/>

Use `[Ctrl+M]` to open the file directly in MusicBrainz Picard, and `[Ctrl+F]` to relocate the file if it was moved on disk.
