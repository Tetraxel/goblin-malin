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

Everything lives in the app's data folder. Provider credentials (Spotify, Soulseek) are in `.env`,
as plain text, readable by your user only; the programs the app starts do not inherit them. If you
use the Claude chat, every message, answer and tool call is written to `agent.log` (up to 10 MB),
and the last conversation to `agent-chat.json`, both as plain text; the chat can be turned off, and
its log disabled, in Settings.

## Scope

The app runs locally and talks to third-party services (Spotify, YouTube, Soulseek, MusicBrainz,
optionally Songlink and the user's own `claude` CLI). Reports about how it handles downloaded
files, spawned tools (yt-dlp, ffmpeg, mpv), stored settings or credentials are in scope. Problems in
those third-party services or tools themselves should be reported to their own projects.
