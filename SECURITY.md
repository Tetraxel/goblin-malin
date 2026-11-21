# Security policy

## Supported versions

Only the latest published version of `goblin-malin` receives fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: open the
[Security tab](https://github.com/Tetraxel/goblin-malin/security) of the repository and choose
**Report a vulnerability**.

Include what you found, how to reproduce it, and the version you tested. This is a one-person
project, so expect an answer within a few days rather than hours.

## What is stored on your computer

Everything lives in the app's data folder (in your user profile by default, or wherever
`GOBLIN_DATA_DIR` points). The app does not lock the folder itself down: it relies on the permissions
of the place you keep it in. Only its private work subfolders (the Claude chat's, the local sockets')
are created readable by your user only.

- **Provider credentials** (Spotify, Soulseek) are in `.env`, as plain text. The file is written
  readable by your user only (mode `0600` on Linux and macOS; Windows ignores the mode, see above).
  The programs the app starts (yt-dlp, ffmpeg, mpv, the package manager, the Claude CLI) do not
  inherit them. Deezer, Apple Music, Tidal, SoundCloud and YouTube links are read without an
  account or a key.
- **YouTube cookies** (optional): if you import a `cookies.txt` in Settings → Download → yt-dlp, a
  copy is kept in the data folder. It is a signed-in session, so treat it like a password. Each
  yt-dlp run works on its own owner-only temporary copy, and the imported file can be removed from
  the same settings screen. "Cookies from browser" lets yt-dlp read your browser's cookies itself;
  the app stores nothing in that case.
- **The Claude chat** (opt-in): every message, answer and tool call is written to `agent.log` (up
  to 10 MB, then rotated), and the last conversation to `agent-chat.json`, both as plain text. The
  chat can be turned off, and its log disabled, in Settings.
- **Sessions, settings and logs** (task lists, search results, application logs) are plain files in
  the same folder. They contain track names and links, not credentials.

## What leaves your computer

The app talks to the services whose links you paste or search: Spotify, YouTube, SoundCloud,
Deezer, Apple Music (iTunes API), Tidal (public pages), Soulseek and MusicBrainz. It also contacts
GitHub to check for a new version of the app (Settings → General switches this off) and to download
yt-dlp, ffmpeg and mpv.

Two features send data to a third party or use your quota, so they are **off until you allow them,
once**, in a confirmation dialog:

- **Songlink** sends the link of each track to `api.song.link`.
- **Claude** (last-resort discovery and the chat) runs your own `claude` CLI, which sends the
  track's details, and for the chat the conversation, to Anthropic under your own plan.

## Downloaded programs and files

- **yt-dlp and the Windows ffmpeg build** are downloaded on first use and checked against the
  SHA-256 list published in the same release. That protects against a damaged download, not against
  a compromised release; an archive that cannot be checked is refused.
- **mpv and the macOS ffmpeg build** are downloaded from third-party sites that publish no
  checksums, so they are **not verified**. This is a known limitation.
- The programs live in the data folder, writable by your user: normal for a per-user tool. Nothing
  is run through a shell, except the package manager when you update the app on Windows (with a
  version number checked first).
- **Files from Soulseek peers** are saved under names the app generates, never the peer's, and are
  then read by ffprobe, ffmpeg, the tag libraries and mpv. Keep those tools up to date.

## Local servers

Two short-lived HTTP servers listen on `127.0.0.1` only, on a random port:

- the **chat's tool server** (while a Claude chat turn runs): a new random bearer token for every
  turn, requests from a browser (`Origin` header) and with a foreign `Host` are refused;
- the **MusicBrainz seed page** (when you add a release): one use, a secret in its path, closed
  after the redirect or 15 minutes.

## Scope

The app runs locally with your rights and talks to the services above. Reports about how it handles
downloaded files, spawned tools (yt-dlp, ffmpeg, mpv), the local servers, stored settings,
cookies or credentials are in scope. Problems in those third-party services or tools themselves
should be reported to their own projects.
