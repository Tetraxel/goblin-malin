# Changelog

All notable changes to this project are documented here.

## [Unreleased] — 0.2.0

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

### Removed

- The Windows `.exe` distribution: install with `npm install -g` only.
- The `prepack`/`postpack` README rewriting (the README now carries absolute image URLs).

## [0.1.15]

- Album and playlist support with live reload; macOS support in the binary installers.
- Songlink and MusicBrainz columns, task management and theme improvements.
- Performance work (render profiling, scroll and memo optimisations) and the `tui-test` harness.
- Removal of the flow abstraction.
