# TODO

> State of 2026-11-22 (`main`, **v0.2.4** released; what comes next is under "Unreleased" in [CHANGELOG.md](CHANGELOG.md)).
> IDs like `DL-01` point to the audits in [docs/audits/](docs/audits/) (evidence and suggested fix for each); `P24`, `P25`… to the projects in [docs/projects/](docs/projects/README.md).

## 🔵 Release backlog

**Bugs / safety**

- [ ] Saving can't be cancelled: an ffmpeg conversion or tagging step keeps running when the task is stopped or the app quits (thread an `AbortSignal` through `saveTrack`; `runFfmpeg` already takes one)
- [ ] A download whose format has no tag writer (wav, wma… with conversion off) is copied untagged and still reported as "Saved" — `tagAudioFile`
- [ ] On the pinned saved file, `Ctrl+F` (relocate) does nothing, and a changed format setting can only be applied from a download row (updating the saved file keeps its format)
- [ ] **Linux has no working ffmpeg/ffprobe download** — `resolveFfmpegSource` treats everything that is not macOS as Windows (fetches the win64 zip); the README says Linux is not supported yet

**Product**

- [ ] Embed cover art — `PROD-04`
- [ ] Temp downloads: move the default out of the Music library (with a one-time migration of the old folder), clean unselected candidates after a save
- [ ] Start the imported tasks from the import dialog (today its choices only set TAG? / DL?; needs the orchestrator to add tasks to a batch already running) — `UX-01`

**Housekeeping**

- [ ] Dependencies held back: ESLint 10 (waits for `eslint-plugin-react`; add `cause`s), TypeScript 7 (waits for `typescript-eslint`) — `DEP-02`, `DEP-03`. `yarn audit` is clean; it runs in CI (non-blocking) and Dependabot proposes minor / patch updates monthly

## 🟣 Promised by the former `README-TARGET`, not built yet

Decide per release whether each is wanted.

- [ ] Tidal albums and playlists, Apple Music playlists (no keyless way to list them today); a Tidal search (needs an API key and a setup wizard)
- [ ] MusicBrainz options: "import files into Picard on save"; `Ctrl+M` opens the saved file in Picard
- [ ] Auto-save to the output folder; auto-relocate missing files + a "Lost the link to the file" warning (relocation exists as `Ctrl+F` only) — `P23/T23.4`
- [ ] `[K]` keep this download and delete the others; `[Ctrl+R]` relaunch downloading + a "Source metadata have changed" banner
- [ ] BPM / Key / Genres from some provider (the three rows always show "—")
- [ ] Waveform scrubber in the preview (today a plain progress bar)
- [ ] `Enter` saves from the source row (today `S` saves and `Enter` selects) — or keep it as is

## 🟡 Nice to have

- [ ] Provider links on each metadata row: Artist, Album, Track
- [ ] Drag and drop tracks
- [ ] Parse links before calling Songlink, to display them better
- [ ] Optional logging to a file (today `app.log` is always written)
- [ ] Music library & duplicate detection — `P23`
- [ ] Search-based / text import — `P26`
- [ ] Audio verification (duration / fingerprint) — `P27`
- [ ] Claude picking the best download source on its own, as a pipeline step (the chat and its tools exist) — `P29/T29.1`
- [ ] Stems: play several stems together (an instrumental from drums + bass + other, `mpvMix.ts`); "Relocate" for a saved stem that was moved; a committed TUI fixture with stems — `P33`

## ✅ Done

The details are in [CHANGELOG.md](CHANGELOG.md); the audit fixes are marked in each audit.

- Platforms: **Deezer, Apple Music, Tidal** (`P28`), **SoundCloud** (tracks and sets), Spotify / YouTube albums and playlists with live refresh, a first-run provider picker
- Discovery: platforms searched in parallel, MusicBrainz identity (`P30`), Songlink and Claude on request or automatically
- Downloads: **Soulseek**, one output format (`PROD-03`), YouTube cookies import (`P24`), verified tool downloads with an alert when one is missing (`DL-01`)
- The saved file is the task's own record; `saveTrack` is tested; MusicBrainz IDs written to the tags (`MD-03`)
- **Claude chat** with typed tools, preview and undo (`P32`, [docs/agent-tools.md](docs/agent-tools.md))
- **Stem separation** with audio-separator, on request: Stems view and tab, models chosen by the user, saved next to the track, Claude tools (`P33`)
- Sessions + archive, groups (`Ctrl+G`), Actions menu (Picard batch), mouse selection, copy / edit cells, restart without the cache
- Data safety: derived data folder, single-instance lock, quit with `Ctrl+Q`, crash handlers that save (`DATA-04`…`DATA-07`); logging capped and rotated (`DATA-10`)
- Release pipeline pinned and CI on Windows + Linux, unit and end-to-end (`REL-01`…`REL-03`); docs rewritten (`DOC-01`, `DOC-03`, `DOC-04`)
