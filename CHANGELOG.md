# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **Chat with Claude** (`Ctrl+T`, or the **Claude** toolbar button): Claude, through your own Claude Code CLI, reads and changes your tasks when you ask: fix titles and artists, pick or reject a download source, add a link you give it, search a track on a platform again. It has no access to your files, a shell or the web, only to the app's tools ([docs/agent-tools.md](docs/agent-tools.md)). Off until you allow it, once.
- The chat shows Claude's answers formatted (bold, italic, `code`, lists, headings, code blocks, links); its text line wraps over up to four rows instead of spilling out of the panel; `PgUp` / `PgDn`, `↑` / `↓` and the mouse wheel scroll (also while the chat has the keyboard), and the view stays where you are reading while an answer is written; `Ctrl+C` copies Claude's last answer (as written, Markdown); the panel's width is changed by dragging its left edge or with `Shift+←` / `Shift+→`, and is remembered. The view tabs (`[1] Metadata view`, `[2] Download view`) stay above the main panels and the chat's title takes the end of that line.
- Tables in Claude's answers are drawn (a grid when it fits, one card per row in a narrow panel). The docked chat shares the app's frame (the task list's right border is its divider, with `┬` / `┴` junctions on the tab line and the footer line), and a click anywhere outside it (task list, toolbar, panels) moves the keyboard there without pressing Esc.
- Claude can **search for music** on the platforms the app reads, even when you do not say where ("find the remixes of Neverender"), and **add tasks** to your list from links you give it or that it found (`search_music`, `add_tasks`: new tasks are not started, and `/undo` removes them while untouched). A platform that can search is found by Claude automatically (`searchTracks` on its metadata service).
- Claude can **start tasks**: `run_metadata` (the metadata part, nothing downloaded), `run_download` (the download part, for tracks whose metadata is ready) and `run_task` (a track never run, from start to end). Anything that downloads asks you first ("Start, and don't ask again in this conversation" is there for a run of several). Already-run tracks are never restarted whole, which would erase what you typed. They are started and run in the background; Claude never saves a file to your music folder.
- Claude can **wait for what it started and check the result**: `wait_for_tasks` blocks (at most 4 minutes, the user can stop it, and it costs nothing while waiting) until the tracks have finished and then gives each one a verdict worked out by the app (ok, failed, needs_attention, stopped, not_run) with the reasons: a failed run, no source downloaded, a download of another length than the track, a missing file, a title with video-site noise, MusicBrainz asking for a check. `review_metadata` reads several tracks' compiled metadata next to each platform's version, with flags (artists or lengths that differ, missing fields…), for the cases worth checking before a download (a non-official video link): by default there is no review. `get_settings` shows the settings in force (secrets, your name and home folder hidden), to work out why something behaves oddly.
- Everything said in the chat and every tool call are logged raw in `agent.log` in the data folder (one JSON object per line, like `app.log`: your message and the prompt it became, Claude's answers, each tool call with its input and its answer uncut, notes, errors, the cost of each turn). It moves to `agent.log.1` at 10 MB, and can be switched off in Settings → Claude agent.
- Each tool call in the chat can be opened (`Ctrl+O` for all, or a click on one) to see what was sent and what came back, raw.
- The chat's model (haiku, sonnet or opus) can be chosen before the first message (`Ctrl+L`, or the "Model" line; the cursor starts on the current one); it is shown in the title.
- The last conversation can be reopened with a button (`Ctrl+R`): a launch always starts empty, since resuming a conversation uses your plan. It is kept in `agent-chat.json` in the data folder.
- What you write in the chat stands on a grey band, a clear "N tasks selected" chip (with the track's name) sits above the text line, and the panel has more room around its content.
- Big changes are planned first (`plan_bulk_override`, `plan_batch`), shown to you, and applied only if you agree; `/undo` reverts Claude's last change (a whole batch counts as one), unless the task changed since.
- A task Claude is changing is locked (shown with the agent glyph); a task being processed is never written by Claude; a change based on an out-of-date read is refused.
- `yarn run agent:tools` prints the tool catalogue (`--md`, `--json`, `--kind`, `--write`).

### Changed

- Edits of a track's metadata, favorites and download selection go through validated `DownloadTask` methods (an invalid ISRC, year… is refused with a reason instead of being stored).

- The STATUS column says what a track is doing for the whole of a stage ("Fetching metadata", "Discovering on other platforms", "Searching downloads", with a clock), instead of "No status" in the gaps between the platforms' own messages (`TaskStatus.setFallback`).
- The dialog that asks before Claude starts downloads names a track that was not read yet by a short link (no `https://`, cut with an ellipsis), so each one stays on its own line.

### Fixed

- A track whose download rows were written by two runs at once (two starts of the same track) was saved with `null` where a row should be, which crashed the Download view and the app at start-up. A run on a track that is already running is now refused (it emptied the rows under the run writing to them), a write to a row that is gone adds a row instead of leaving a hole, and sessions already saved with holes load again.
- The chat's tool calls were cut by the Claude CLI after 60 seconds ("The operation timed out"), so a question left unanswered for a minute made Claude ask again: the dialog appeared twice. The CLI is now given 9 minutes per call, a repeated call joins the one being answered instead of asking again, and an answer given after the conversation moved on starts nothing.
- "Copy artist" and "Copy track title" on a task row copy what the cell shows (the merged metadata, with your overrides), not the artist of the pasted link: for a YouTube lyrics upload that was the uploader's channel instead of the artist.

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
