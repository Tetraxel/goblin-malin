# goblin-malin 😉

> [!CAUTION]
> **This project is in early, early, early development.**<br>
> Be aware that the data model can change drastically, making previous versions incompatible with the current one. Use at your own risk 😉

A keyboard-driven terminal UI for downloading and tagging music tracks with metadata. Import links from Spotify, YouTube, the app cross-references metadata across providers, finds the best download source (only yt-dlp for now), and saves it to disk with clean tags.

## Installation

[![Windows](https://img.shields.io/badge/-Windows_x64-blue.svg?style=flat&logo=windows&logoColor=%23ffffff&color=%230078d4)](https://github.com/Tetraxel/goblin-malin/releases/latest/download/goblin-malin-win-x64.exe)

### Running the project as a developer

You can run the project as a developer:

1. Clone the repository and open a terminal in the project directory
2. Install [Node.js](https://nodejs.org/en/download) and [yarn](https://classic.yarnpkg.com/lang/en/docs/install)
3. Install dependencies in the project directory: `yarn install`
4. Run the application: `yarn run dev`

### Launching the app in js code

> Not customizable yet

```js
import GoblinMalin from "goblin-malin";

GoblinMalin.start();
```

## Steps

- Import with `Ctrl+V` URLs from compatible streaming platforms :
  - `Spotify` (requires Spotify Premium Account to have full metadata)
  - `YouTube`
- System fetches primary metadata from the corresponding URL platform
- System discovers the same track on other platforms (cross-referencing via ISRC or track/artist name)
- Filters/orders metadata sources by relevance or leaves the default ranking chosen by the system (use `TAB` key to switch the focused window).
- System downloads matching tracks from available download providers:
  - `yt-dlp`
- User selects the best download source and previews the audio
- User saves the file to the desired folder with embedded tags

## Screenshots

### Metadata view

<img src="docs/screenshots/2026-05-14-metadata-view.png" width="100%"/>

### Download view

<img src="docs/screenshots/2026-05-08-download-view.png" width="100%"/>
