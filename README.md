# goblin-malin 😉

> [!CAUTION]
> **This project is in early, early, early development**

A keyboard-driven terminal UI for downloading and tagging music tracks with metadata. Import links from Spotify, YouTube — the app cross-references metadata across providers, finds the best download source (only yt-dlp for now), and saves it to disk with clean tags.

## Installation

No easy installation yet. You can only run the project as developer:

1. Clone the repository
2. Install [yarn](https://classic.yarnpkg.com/lang/en/docs/install)
3. `yarn run dev`

## Steps

- Import track URLs from compatible streaming platforms with `Ctrl+V`:
  - Spotify
  - YouTube
- System fetches primary metadata from the corresponding URL platform
- System discovers the same track on other platforms (cross-referencing via ISRC or track/artist name)
- Filters/orders metadata sources by relevance (or leaves the default ranking chosen by the system)
- System downloads matching tracks from available download providers:
  - yt-dlp
- User selects the best download source and previews the audio
- User saves the file to the desired folder with embedded tags

<img src="docs\screenshots\2026-05-08-download-view.png" width="100%"/>
