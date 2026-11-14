# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.2.2] — 2026-11-14

### Added

- **MusicBrainz release check.** For each track the app works out which MusicBrainz release it belongs to (from the barcode, the streaming link, the ISRC, or the title and artist) and shows a verdict with the evidence behind it. You can review a match, pick the artist, re-check, or add a release MusicBrainz doesn't have yet (through Picard, Harmony or a local seed page). A **Search** button opens the tag lookup already filled with the track. Like the other third-party lookups, it only runs after you allow it once.
- MusicBrainz ids in saved files: the album artist and release track ids are now written next to the recording, release, artist and release group ids (FLAC, MP3 and the ffmpeg formats), and read back from the file. A per-track **Include MusicBrainz tags** switch overrides the setting.
- Settings → Download → **Download strategy**: `best` (the first provider that downloads wins), `each` (one file per provider, the default) or `all` (up to 5 files per provider). Providers skipped by `best` show a "not needed" row and can still be run by hand.
- Settings → General → **Reduce terminal output**: redraw only the screen lines that changed (2–4× fewer bytes for the terminal to parse). On by default on Windows, off elsewhere; applies on the next start.
- A saved file that was moved or deleted is flagged in the task list and the file panel, with a **Relocate** button (Ctrl+F); play, update and compare are blocked until it is found again. The panel also shows the tags the saved file really holds (in file / differs / not in file) instead of the download's.
- Pasting a link while a track is focused can add it to that track, and links you add by hand are kept when the task is restarted.

### Changed

- **Much smaller install.** The sound effects now ship as Ogg Vorbis: the npm package goes from about 131 MB to 14 MB, so every update downloads far less.
- **Faster keys.** In the shipped build a `↓` on a 2,000-task list used to paint two full frames, the second 130–270 ms late, and Ink rebuilt every character of the screen for each of them. The lower panel now follows the cursor in the same frame for a single key press (and still waits while a key is held), and a patched Ink keeps its work from one frame to the next. At 200×60 the screen is settled ~20 ms after the key instead of ~170 ms, with half the bytes ([AUDIT-performance-2.md](AUDIT-performance-2.md)). The action bar under the task list also no longer repaints the screen a second time after every selection change: a single key now costs half the output it did (about 10 KB instead of 20 KB at 128×50) and settles in ~25 ms instead of ~50 ms.
- Ink is now bundled into `dist` (with the patch from `patches/ink/`); in a checkout, `yarn install` applies the patch to `node_modules`.
- The YouTube client library loads on first use, not at start-up.
- Long task lists stay responsive: saving only rewrites what changed, the footer and the Sessions/Archive badges only redraw when their text changes, closed modals no longer follow every save, and spinners use the shared animation ticker (so Settings → Animations applies to all of them).

### Fixed

- Settings: the last row is no longer cut off when rows wrap onto several lines.

## [0.2.1] — 2026-11-11

### Added

- Spotify search market is now a setting (empty = the country of the OS locale).
- One click on a TAG?/DL? checkbox toggles it.

### Changed

- Providers declare `platformAliases`, `trackUrl` and `openLabel`; core code no longer branches on provider keys.
- Live refresh only refreshes a playlist that already ran, and backs off (doubling up to an hour) after consecutive failures instead of retrying every 5 s.

### Fixed

- Saving: a failed FLAC tag write is reported as a failed save; a file is built beside its destination and renamed into place, so an interrupted save no longer leaves a truncated file or deletes the one being replaced; one save at a time per task; FLAC re-tagging replaces the file's old tags; a save that replaces another task's file takes ownership of it.
- File names (automatic, typed and temp) are cleaned the same way, and capped in bytes.
- Each yt-dlp run works on its own copy of `cookies.txt`, so parallel runs can't break the exported cookies.
- A single mpv exit hook instead of one per restart (no more `MaxListenersExceededWarning`).
- The Claude CLI now starts when installed with npm on Windows.
- Welcome intro: dialogs raised by background work wait until it has closed, and it repaints at once when Ink wipes the screen.

## [0.2.0] — 2026-11-10

### Added

- **Soulseek** download provider, alongside yt-dlp.
- **Claude** as an opt-in, last-resort discovery provider (uses the user's own `claude` CLI).
- Archive: tasks can be archived to keep their metadata out of the task list; the archive is scoped to the current session.
- Download detail panel rework: live download stats and service output, per-field diffs, editing of file name, folder, tags and metadata, a save shortcut, and a record of what was written to a saved file's tags. Saved files can be pinned and replaced (with a confirmation).
- Show each source's query and a playing marker; background music playback with Space on the selected task.
- Animated welcome intro (mascot, app tour, iris outro) with sound, played through an mpv audio mixer.
- Mouse support: task list, toolbar, tabs, secondary panel, modals; hover highlights, click to fold playlists, Ctrl+Shift range selection and batch actions on multi-select.
- Warning when a playlist can't be read (likely private), with a "don't show again" option.
- Skip-discovery action.
- Cleaning of temporary downloads by session use and age, with a reminder, an auto-clean option and a size row in settings.
- Ctrl+Q to quit.
- CI: type-check, lint, build and unit tests on every push; release depends on CI and is gated on tag == version; workflow actions pinned by commit SHA; Dependabot for GitHub Actions.
- Test coverage, and lint/format/type-check extended to `tests/` and `scripts/`.
- Output format: Settings → Download → _Convert every download to one audio format_ (on by default, to FLAC) with a choice of FLAC, MP3, Ogg, Opus or M4A. Turned off, each track keeps the format it was downloaded in; yt-dlp then keeps YouTube's own codec instead of re-encoding it to FLAC.

### Changed

- Node 22+ is now required; `postinstall` is non-fatal.
- A single data folder; safer saving of `sessions.json` and `settings.json` (protection against silent data loss) and a safer exit.
- Pasting a link into a text field now stays in that field.
- Metadata matching: Unicode-aware confidence, empty names score 0, live/remix/karaoke/cover versions are penalised.
- Scraped Spotify data is no longer cached; "not found" results are kept for 1 day; identical in-flight cached calls are shared.
- ffmpeg/ffprobe and other tool downloads are verified and shared; logs are lighter.
- README rewritten; dependencies bumped (slsk-client 2 ported).
- Removed `emitDecoratorMetadata` and `@swc/core`; type imports are enforced; UTF-8 is checked in CI.

### Fixed

- `yarn build` succeeds again.
- ffmpeg/ffprobe are downloaded on a fresh install again, and an alert is shown when a tool can't be set up.
- "Clear temporary downloads" refuses unsafe folders and asks first.
- No shell is used for opening URLs or running the updater.
- The dotenv startup banner is silenced.
- Clipboard read is asynchronous; read-only settings row layout; live import hint; stale task selection.
- The YouTube fetch status clears once the call succeeds; the elapsed timer keeps ticking in status cells; the playback bar highlights when the download detail is focused.
- A download in flight is cancelled when its source is rejected.
- The file a track was saved as is kept on the task, apart from the download sources: downloading again, retrying a provider or restarting the task no longer makes it disappear, and it still shows what it was made from. Older sessions are converted when loaded.
- An MP3 downloaded from Soulseek is no longer saved as a `.flac` file that is really an MP3: saving converts it to the chosen format, or keeps it as an MP3.

### Removed

- The Windows `.exe` distribution: install with `npm install -g` only.
- The `prepack`/`postpack` README rewriting (the README now carries absolute image URLs).

## [0.1.15]

- Album and playlist support with live reload; macOS support in the binary installers.
- Songlink and MusicBrainz columns, task management and theme improvements.
- Performance work (render profiling, scroll and memo optimisations) and the `tui-test` harness.
- Removal of the flow abstraction.
