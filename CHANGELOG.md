# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **SoundCloud**: paste a `soundcloud.com/<artist>/<track>` link (or an `on.soundcloud.com` short link) and the track is read like a Spotify or YouTube one, with its own column in the list. While discovering, the app also searches SoundCloud for tracks from other platforms and proposes the uploads that really look like the track (a slowed edit or an unrelated upload is left out). **yt-dlp downloads from SoundCloud**: when a SoundCloud link is the best source, it shows as a yt-dlp download source. Playlists (`/sets/`) are not imported yet. SoundCloud can be switched off in Settings → Metadata.
- **Groups** (`Ctrl+G`): put the selected tracks (or the focused one) together under a name you choose, like an imported album or playlist: a `[GROUP]` row with its tracks under it, foldable (`C`), with its own TAG? / DL? boxes, count and Start (`R` starts its tracks). `Enter` on the group's name renames it, `U` dissolves the group (its tracks stay) or, on a track, takes it out of its group. A track grouped again moves to the new group; a group left empty goes away. Archive / Delete on a group takes its tracks along, and groups are saved with the session.
- **Metadata Sources shows why a source was found** (`E`, "Toggle search details"), like Download Sources shows its query: under each "found by" line, what the service was actually asked (Spotify / YouTube / SoundCloud: the search text and what it kept of the answer; Songlink: the link and its page; MusicBrainz: the ISRC, the search and the recording; Claude: the search, the platforms wanted and the model), and under the result how its confidence adds up (`Title +40 · Artist 0 (different artists) · Duration 0 (3.1% apart)…`), so a 0% source can be explained. Results found before this update show only what they used to.
- **Your Claude plan's usage at the top of the chat.** Two bars, 5 hours and 7 days, with the time each one resets (`5h ████░░░░ 41% resets 14:30`). The Claude Code CLI reports both windows with every message, so the figures are those of the last message (kept on disk to show again at the next launch, and shown empty once a window has reset); nothing is asked of Anthropic in between and no credentials are read. The bars turn amber at 70 % and red at 90 %.
- The harness (`scripts/tui-test`) knows `Ctrl+G` and `Ctrl+Shift+↑/↓`; `examples/group-tasks.json` walks the whole flow.

### Changed

- **Spotify and YouTube searches no longer take the first hit unchecked.** When looking for a track on another platform, the app now scores the top 8 hits against the track and proposes the best one only if it reaches 50% (the same bar SoundCloud already used). Before, a search for "Song (Some Remix) Artist" could lead with another song sharing only the remixer's name and show up as a 0% source; now the real track is picked when it is further down the list, and nothing is proposed when it is not there at all.
- **YouTube: video uploads are found too, after the songs.** YouTube Music's "Songs" search only lists catalogue tracks, so a remix that only exists as someone's upload (a DJ's channel, a re-upload) was never found. The app now also searches YouTube's videos, reads the artist and title out of the video's title ("AutoReverse - Reflections (She Said Disco Remix)" → artist AutoReverse, not the channel), and proposes up to two uploads that look like the track. They are listed **after** the songs, so they are only the download source when no song qualified, and they need 60% instead of 50% (an upload of the original mix must not pass for the remix). A failed video search never loses the songs. Tracks found this way (and every SoundCloud track) are marked as uploads. **Claude's chat finds them too**: `search_music` lists a few videos after the songs, each with `upload: true`, and its description tells Claude to check an upload's title and duration and to prefer a catalogue track when both fit.

### Fixed

- **`R` no longer rebuilds a finished track on the spot.** Restarting a track that was run now asks first (Cancel is the button the cursor starts on), and on an album or playlist it asks what to do with the tracks: archive them (they can be brought back from the Archive) or delete them. Before, one keypress emptied the track's metadata and download rows, or removed every track of the playlist, with no way back.
- **What you typed over the metadata (title, artists…) survives a restart.** "Stopped, then start", `R` on a finished track and "Run selected" used to reset it to nothing; like the links you add, it is yours and is never rebuilt.
- **M4A files are tagged in the form other software reads.** The tags were written in a layout only ffmpeg understands, so iTunes / Apple Music, phones and MusicBrainz Picard saw an untitled file. Title, artist, album, date, track and genre are now the standard atoms; ISRC, tempo (`tmpo`), key and the MusicBrainz ids are added the way Picard writes them. Files tagged before are not rewritten; tag them again to fix them.
- **A YouTube link copied from a playlist (`...&list=...`) downloads the video, not the playlist.** yt-dlp took the playlist's first video under the track's name and then walked the whole list. It is now asked for the single video, and the track keeps the video's own address.
- **Passwords and secrets with special characters survive a restart.** A value containing `#`, quotes, a backtick, a backslash or spaces was written to `.env` raw and read back cut short (a Soulseek password was silently changed at the next launch). Such values are now quoted; a value with a line break is refused instead of creating another variable.
- **Another session cannot be opened (or created, duplicated, or the open one deleted) while work is going on.** Doing so started the other session's tasks by itself and dropped the rest of the run. The Sessions window says why it is refused.
- **A failed tool update no longer removes the working yt-dlp / ffmpeg / ffprobe / mpv.** The new version is downloaded under a temporary name, checked, and only then put in place; the old one is deleted last. A download cut short (closed terminal, sleep, kill) can no longer leave a truncated tool that is trusted afterwards.
- **A settings file that cannot be written is no longer silent.** A full disk or a locked folder now shows a notice and a log line, the change stays active for the session, and saving is retried. Errors from keyboard shortcuts also reach `app.log` (they were lost once the interface started).
- **Duplicating a session warns that the copy shares its files with the original.** Both keep the same temporary downloads and saved files, so saving again, retrying or cleaning up in one can delete or move a file the other still lists. Duplicate now says so and asks first.
- **Saving a track again no longer deletes a file you relocated.** When the saved file was pointed (Relocate) at a copy kept elsewhere, replacing it by a new save used to delete that copy without a word. The app now remembers where it wrote the file and asks before deleting one that is somewhere else ("Keep it" is the button the cursor starts on).
- **YouTube links in more shapes are read**: Shorts, live pages, embeds (also on `youtube-nocookie.com`) and `/v/` links. A link with no valid 11-character video id (`/watch` with no `v=`, `youtu.be/<id>/anything`) is no longer taken for a track with a broken id.
- **A yt-dlp download can be stopped for good, and cannot fill the disk.** A stop that comes before or during the set-up no longer starts the download; a stopped or failed run removes its partial files and, on Windows, ends the ffmpeg yt-dlp started; your own `yt-dlp.conf` is ignored; live streams, videos over 3 hours and files over 500 MB are skipped (a Soulseek file announced over 500 MB too). The "no cookies file" line is no longer a warning on every track.
- **Soulseek**: a `.flac` that is not FLAC is shown as lossy; a search timeout of `1` or a negative one can no longer be set.
- **Tags**: an empty album artist is never written; the full release date (not only the year) goes in `DATE` (FLAC, Ogg, Opus, M4A) and in the day/month frame of MP3; the retag rename retries when an antivirus holds the file on Windows.
- **Closing the app ends what it started and says whether everything was kept.** Running downloads and an ffmpeg conversion are stopped (a package-manager update is left to finish: a cut install can break the app); the exit code is 1 when the session could not be saved.
- **The update window is safer**: the release page opens through the same checked opener as other links, the update command stops after 10 minutes, it can be closed while it runs (the install goes on and is never cut), its output is split into lines properly, the package manager is recognised from where it keeps global packages only (not from a folder called "yarn"), and a pre-release version (`0.2.4-beta.1`) is compared correctly.
- **Your Spotify and Soulseek credentials are no longer inherited by the programs the app starts** (yt-dlp, ffmpeg, mpv, the package manager, Claude). The Claude CLI now runs in a private folder of the app's own instead of the shared temp folder, and its chat config file is created readable by you alone (a chat started before this update cannot be resumed once).
- **Chat writes to one track go one at a time**, so two parallel calls cannot both pass the checks and change it side by side.
- **mpv's control socket is private** (a folder only you can enter; a random pipe name on Windows), downloads have a size and a total-time limit, and a cookie copy left by a killed download is removed at the next start.
- **A dialog nobody answers no longer stops all metadata work.** The first-use consent question (Songlink, Claude) and the slow last-resort Claude call held one of the few metadata slots while they waited, so a few tracks waiting on a dialog could freeze every other track. They now give the slot back while they wait.
- **A link whose own service is down no longer triggers a Claude call with an empty track.** The fallback that asks the discovery services for the track from its link now leaves out the last-resort ones (Claude), which need a real track to search for.
- **A stopped discovery is no longer marked as done**, so the Download action does not treat a half-finished search as complete.
- **A restart clears the Songlink and MusicBrainz cells with the rest.** They kept their old count and mark while the track had no metadata at all.
- **An album or playlist says when tracks were left out because they are already in the queue.** A track has one row wherever it came from first, so a list of 50 could show 47 rows with no explanation; the status now reads "50 tracks (3 already in the queue elsewhere)".
- **"Run all" on a reopened session no longer stamps "Queued" on finished tracks.** What a run takes is now decided by the track's saved state (pending or stopped), not by a flag that is lost when the session is closed. A track that was cut off mid-run (app closed or killed) comes back as "stopped" instead of staying "running" for ever.
- **Delete leaves a running track in the list.** Removing it detached its work with nothing left to stop it; Delete now skips a running track, as Archive does (stop it first).
- **Soulseek ranks the right version.** The "extended" / "club mix" bonus is only given when the title asks for it, and a live, instrumental, karaoke, a cappella or acoustic file is no longer taken for the studio track (and the other way round). A peer that reports a speed of 0 (many do) is no longer dropped from the results. When a search finds nothing usable, it is made again with a shorter title (no "- 2011 Remaster", no "(feat. X)", no leading `-` that Soulseek reads as an exclusion). A new search only clears the temporary files of this track's own rows, not those another session or the saved file points at.
- **File names: Windows device names (`NUL`, `CON`, `COM1`…) get a `_` in front**, bidirectional control characters are removed, and accents are written in one form. **Two tracks saved to the same file name at once** are saved one after the other (the second one asks before replacing the first), and each save uses its own staging file.
- **`.env` is written safely.** The file is replaced atomically (a crash can no longer empty it), readable by its owner only on Linux and macOS, edits are queued instead of overwriting each other, and a key is matched as plain text.
- **Closing a setup wizard no longer switches the provider off.** The step fails, and you are asked whether to turn the provider off (default: keep it on).
- **Started without a terminal, the app says so and exits** instead of showing a React error and hanging. `--version` and `--help` are answered without opening the interface.
- **"Stop" reaches the metadata stage, and tracks started by hand.** Stop used to be looked at only between the stages of a track, so a provider that was slow (or never answered) kept going, and a track started with `R`, a re-fetch or a download from the list could not be stopped at all. Every run now has its own stop: the toolbar's Stop, a removal and the chat's Stop reach them. With no batch going, `R` runs the track as a batch of one (under the global cap, with the Stop button and the session guard).
- **Provider requests have a time limit.** Songlink, Spotify, YouTube Music, MusicBrainz and `ffprobe` calls now fail after 30 seconds (two minutes for MusicBrainz, whose own rate limit queues calls) instead of holding one of the few metadata slots for minutes.
- **A failed Soulseek search no longer breaks other tracks' downloads.** The shared connection is torn down only when no transfer is running on it, and a stopped task stops waiting for its search.
- **Re-saving tags no longer rewrites your file in place.** The tags go on a copy that replaces the file once whole (a crash or a full disk could leave the only copy truncated), and the FLAC clean-up no longer reads and rewrites the whole file on the interface's thread.
- **Cover art survives a retag of M4A, Ogg and Opus files.** It was dropped; it is now put back (a picture that cannot be kept never stops the tags from being written).
- **A download that outlives a change of the list writes to its own row.** Rows have a key of their own, so a retry of one candidate, or "reject", no longer lands on another row after another provider was retried or more results were shown.
- **ffmpeg comes from a stable branch, not the nightly development build**, is downloaded again once a month instead of at every daily rebuild, and ffmpeg and yt-dlp are refused when their published checksum cannot be fetched or does not list them. The ~200 MB archive is extracted by the bundled 7-Zip in its own process instead of freezing the interface.
- **A stale lock file no longer keeps the app from starting.** The owner touches it every minute, and a lock nobody touched for five minutes is taken over even when its pid has been reused by another program.
- **The API cache is bounded** (3,000 entries), saved in the background, and dates read back from it are dates again after a restart.
- **A Claude failure is classified from its own words, not the model's.** A page that mentions a "rate limit" or a "quota" no longer blocks Claude for ten minutes.
- **A log that fills itself with "Encountered two children with the same key".** In development, a message with a `%s` in it (every React warning) lost its id and time on the way to the log panel, so every such row had the same key, which React warned about, which was logged with a `%s`... thousands of lines in seconds. The logger keeps the metadata whatever the message holds, and `console.error(format, args)` is written with its arguments filled in.
- **"Cannot update a component while rendering a different component".** Registering a keyboard-shortcut context told the hint bar from inside the render of the component that owns the context; it is now told once the render has been committed (the first one is still in the registry before anything reads it). The "possible EventEmitter memory leak" warning (one listener per hint on screen) is gone too.
- **The task action bar is no longer cut in the middle of a hint.** What does not fit is shown as its key (`[T]`), and `…` when even that does not fit.
- **Ctrl+V in Claude's message line.** In a terminal that delivers Ctrl+V as a key (instead of typing the clipboard into the app), nothing was pasted into the chat. The chat now has its own `Ctrl+V` (rebindable, "Paste the clipboard into the message"): it reads the clipboard and puts it in at the cursor as one line. Terminals that already type the pasted text in keep working as before.

## [0.2.3] — 2026-11-16

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
- Moving the cursor on Windows no longer paints a second, identical screen on every other key: the Metadata and Download panels follow the selected task without an extra redraw, so a key costs about half the output.
- The dialog that asks before Claude starts downloads names a track that was not read yet by a short link (no `https://`, cut with an ellipsis), so each one stays on its own line.

### Fixed

- The Metadata panel crashed the app ("groups is not iterable") when the cursor moved onto an album or playlist row, easy to hit by holding `↑` in a long list.
- A track whose download rows were written by two runs at once (two starts of the same track) was saved with `null` where a row should be, which crashed the Download view and the app at start-up. A run on a track that is already running is now refused (it emptied the rows under the run writing to them), a write to a row that is gone adds a row instead of leaving a hole, and sessions already saved with holes load again.
- The chat's tool calls were cut by the Claude CLI after 60 seconds ("The operation timed out"), so a question left unanswered for a minute made Claude ask again: the dialog appeared twice. The CLI is now given 9 minutes per call, a repeated call joins the one being answered instead of asking again, and an answer given after the conversation moved on starts nothing.
- "Copy artist" and "Copy track title" on a task row copy what the cell shows (the merged metadata, with your overrides), not the artist of the pasted link: for a YouTube lyrics upload that was the uploader's channel instead of the artist.

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
- **Faster keys.** In the shipped build a `↓` on a 2,000-task list used to paint two full frames, the second 130–270 ms late, and Ink rebuilt every character of the screen for each of them. The lower panel now follows the cursor in the same frame for a single key press (and still waits while a key is held), and a patched Ink keeps its work from one frame to the next. At 200×60 the screen is settled ~20 ms after the key instead of ~170 ms, with half the bytes. The action bar under the task list also no longer repaints the screen a second time after every selection change: a single key now costs half the output it did (about 10 KB instead of 20 KB at 128×50) and settles in ~25 ms instead of ~50 ms.
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
