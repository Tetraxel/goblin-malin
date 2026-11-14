# TODO

> State of 2026-11-10 (`main`, working towards **v0.2.0**).
> IDs like `DL-01` or `DATA-04` point to [AUDIT-v0.2.1.md](AUDIT-v0.2.1.md), which has the evidence and the suggested fix for each.
> Per-project roadmap: [docs/projects/](docs/projects/README.md) (`P24`, `P25`… below).

## 🔴 Release blockers (v0.2.0)

- [ ] **Release 0.2.0** — bump `package.json` to `0.2.0`, rehearse with a `dry_run` of `release.yml`, then tag `v0.2.0` — `REL-02` (the pipeline itself is fixed and its actions are pinned by SHA, `REL-03`)
- [x] **MusicBrainz IDs never reach the saved file** — done in `P30`: "Write MusicBrainz IDs into saved files" setting (on by default), the IDs shown in the compiled metadata, release/recording/artist/release-group written to the tags — `MD-03`
- [ ] Status per service (Spotify, Ytdlp, etc...) instead of per task — `P25`
- [ ] Easier `cookies.txt` extraction for yt-dlp (drag and drop? step by step instructions?) — `P24/T24.3`
- [ ] Better way to select the app path / folders in settings (a path picker; the temp folder defaults to a sub-folder of the Music library) — `P24/T24.4`

## 🔵 Release backlog

**Bugs / safety**

- [ ] Saving can't be cancelled: an ffmpeg conversion or tagging step keeps running when the task is stopped or the app quits (thread an `AbortSignal` through `saveTrack`; `runFfmpeg` already takes one)
- [ ] A download whose format has no tag writer (wav, wma… with conversion off) is copied untagged and still reported as "Saved" — `tagAudioFile`
- [ ] No unit tests for `saveTrack` itself (delete-after-write order, tag failure after a rename, partial output): it needs a mocked harness, like the one `retryDownloadProvider.test.ts` has for the other task actions
- [ ] On the pinned saved file, `Ctrl+F` (relocate) does nothing, and a changed format setting can only be applied from a download row (updating the saved file keeps its format)

**Product**

- [ ] Embed cover art — `PROD-04`
- [ ] Temp downloads: move the default out of the Music library (with a one-time migration of the old folder), clean unselected candidates after a save
- [ ] Handling of **SoundCloud** links
- [ ] Add a button `Open all tracks in MB Picard`

**Housekeeping**

- [ ] Dependencies left: `zod` advisory (waits for `ytmusic-api` on zod 4), ESLint 10 (waits for `eslint-plugin-react`; add `cause`s), TypeScript 7 (waits for `typescript-eslint`) — `DEP-02`, `DEP-03`
- [ ] `tests/e2e/perf.test.ts` › "an isolated key paints one frame, not two" fails on Windows: in the profiling entry (`src/profiling/profiledEntry.tsx`, React dev mode) every other key still makes a second commit that renders none of our components (≈6 ms after the key, 0 components, 2 host nodes) and repaints the whole screen (~41 KB instead of ~20 KB). The shipped build is fine (`scripts/tui-test/bench/latency.ts`: one frame per key). Not run by CI. Find what triggers that commit, or move the check onto the shipped bundle
- [ ] Get the unit tests green on Linux CI, then enable them there (they only run on Windows now)
- [ ] **Linux has no working ffmpeg/ffprobe download** — `resolveFfmpegSource` has a macOS branch and treats everything else as Windows (fetches the win64 zip); check, and either add a Linux build or state Linux is unsupported

## 🟣 Promised by the former `README-TARGET` but not built yet

Decide per release whether each is wanted.

- [ ] Import from **Deezer, Apple Music, Tidal** (and SoundCloud) + matching provider toggles in Settings — `P28`
- [ ] MusicBrainz options: "import files into Picard on save"; `Ctrl+M` opens the saved file in Picard
- [ ] Auto-save to the output folder; auto-relocate missing files + a "Lost the link to the file" warning (relocation exists as `Ctrl+F` only) — `P23/T23.4`
- [ ] `[K]` keep this download and delete the others; `[Ctrl+R]` relaunch downloading + a "Source metadata have changed" banner
- [ ] BPM / Key / Genres from some provider (the three rows always show "—")
- [ ] Waveform scrubber in the preview (today a plain progress bar)
- [ ] `Enter` saves from the source row (today `S` saves and `Enter` selects) — or keep it as is

## 🟡 Nice to have

- [ ] Add provider links to each metadata row: Artist, Album, Track
- [ ] Drag and drop tracks
- [ ] Parse links before calling SongLink to better display them
- [ ] Optional logging output to a file (today `app.log` is always written)
- [ ] Music library & duplicate detection — `P23`
- [ ] Search-based / text import — `P26`
- [ ] Audio verification (duration/fingerprint) — `P27`
- [ ] Claude as an assistant (pick the best source, fix metadata) — `P29`

## ✅ Done (removed from the lists above)

- [x] **Output format** — Settings → Download → "Convert every download to one audio format" (on by default, FLAC; MP3 / Ogg / Opus / M4A, or off to keep each download as it came); one ffmpeg step at save time, per-format tags; a Soulseek MP3 is no longer saved as a fake `.flac` — `PROD-03`
- [x] **The saved file is the task's own record** — kept on the task (`savedFile`, with what it was made from) instead of on a download row, so Restart / Re-download / provider retry no longer make it disappear; shown pinned under a "SAVED FILE" title; older sessions are converted on load

- [x] **Data safety and quitting** — the data folder is derived and never stored (`DATA-04`); `Ctrl+Q` (rebindable `global.quit`) quits, asking first (`UI-02`); a link pasted into a focused text field stays there (`UI-01`); self-update exits through `exitApp()`, crash/signal handlers restore the terminal and save (`DATA-06`, `DATA-07`); write failures are surfaced, retried on close, and a second instance is locked out (`DATA-05`)
- [x] **Docs** — README rewritten for v0.2.0 (`DOC-03`), `docs/audit/*` replaced by `docs/ARCHITECTURE.md` (`DOC-01`), dead links in `docs/projects/` fixed (`DOC-04`)
- [x] **Tool downloads** — yt-dlp and ffmpeg are SHA-256-verified against the vendor's published list (a missing list only logs a warning; a mismatch deletes the file and fails), `mpv-setup.ts` uses `#utils/http` (mpv's vendor publishes no checksums), ffmpeg and ffprobe share one archive download — `DL-01`
- [x] **Logging** — task id instead of the whole task, `Error`s serialised, previous session's log kept as `app.prev.log`, 10 MB cap — `DATA-10`
- [x] **Hint about missing credentials in Settings** — under a provider's "Setup Wizard" row a one-line note says what finishing the setup unlocks (Spotify: album, year and ISRC for YouTube imports); a service declares it as `setupWizard.benefits`
- [x] Save the tasks to disk as sessions (+ archive)
- [x] **Soulseek** download provider
- [x] Handle Spotify albums and playlists as input (and YouTube playlists), with live refresh
- [x] Copy / edit cell values
- [x] Button to rerun a task without the cache (Restart / Re-fetch / Re-discover bypass it)
- [x] Audit quick wins: `yarn build` fixed (`REL-01`), CI added, `engines` Node ≥ 22, `postinstall` can't fail an install, dead dependencies removed, "Clear temporary downloads" made safe and confirmed (`DATA-01`), `.env.example` and doc links fixed, dotenv banner silenced
- [x] **ffmpeg / ffprobe download works on a fresh install again** — redirects are followed (GitHub moved BtbN/FFmpeg-Builds → `FFmpeg-Builds/FFmpeg-Builds`) and a failed download now says why. Deliberately no fallback to a system `ffmpeg` on `PATH`, so behaviour doesn't depend on the user's machine — `DL-01`
- [x] **Alert when a tool (yt-dlp, ffmpeg, ffprobe) can't be found or downloaded** — a dialog with the cause and what stops working, once per tool until it next works (`binaryAlertBridge`, `withBinaryAlert`); yt-dlp's setup no longer swallows its cause
