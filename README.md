<h1 align="center">goblin-malin 😉</h1>

<p align="center">
  <b>Paste a music link. Get a properly tagged audio file.</b><br/>
  A keyboard-driven terminal app that finds your tracks on every platform, compares the metadata,<br/>
  picks the best source and saves a clean, tagged file, <b>FLAC</b> by default.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/goblin-malin"><img alt="npm" src="https://img.shields.io/npm/v/goblin-malin?color=cb3837&logo=npm"/></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A5%2022-3c873a?logo=node.js&logoColor=white"/>
  <img alt="Windows · macOS" src="https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS-444"/>
  <a href="LICENSE"><img alt="License: PolyForm Noncommercial" src="https://img.shields.io/badge/license-PolyForm%20NC%201.0-blue"/></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Tetraxel/goblin-malin/main/docs/screenshots/metadata-view.png" width="100%" alt="Goblin Malin: a list of tracks, each one found on Spotify, YouTube, SoundCloud, Deezer, Apple Music and Tidal, with its compiled metadata below"/>
</p>

```bash
npm install -g goblin-malin
goblin-malin
```

Then press **`Ctrl+V`** with a Spotify, YouTube, SoundCloud, Deezer, Apple Music or Tidal link on your clipboard. That's it.

- [Why you might like it](#why-you-might-like-it)
- [How it works](#how-it-works)
- [What it can read, search and download](#what-it-can-read-search-and-download)
- [Screenshots](#screenshots)
- [Install](#install)
- [First run](#first-run)
- [Keyboard](#keyboard)
- [Privacy](#privacy)
- [Where your data lives](#where-your-data-lives)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing) · [License](#license)

## Why you might like it

**It starts from the link you already have.** A track, an album or a playlist, from any of six platforms. Short links, links without `https://` and `spotify:track:…` URIs work too. A playlist can keep refreshing itself.

**It cross-checks instead of trusting one source.** The same track is looked up on every other platform (by ISRC when possible, by artist and title otherwise), each platform searched at once and shown in its own group with a confidence score. Title, artists, album, year, ISRC and track number are merged into one set of **compiled metadata** that you can edit field by field. [MusicBrainz](https://musicbrainz.org) tells which release the track is on, and its IDs go into the saved file.

**It is honest about quality.** Downloads from **yt-dlp** (YouTube, SoundCloud) and **Soulseek** (peer-to-peer, searched by artist and title) are listed side by side, with their real codec, bitrate and size, and you can preview each one before choosing. A FLAC that was transcoded from YouTube's Opus is marked `FLAC*`: it is not pretending to be lossless. A genuine lossless file from Soulseek is not.

**It saves the format you want, tagged properly.** FLAC by default; MP3, Ogg, Opus or M4A if your software needs it (rekordbox, say), or keep each download as it came. Tags are written in the form other software reads (iTunes, phones, MusicBrainz Picard).

**It never throws away what you typed.** A link you pasted onto a track, a title you corrected: they live outside everything the pipeline rebuilds. Restarting, re-discovering or stopping a task never removes them, and anything that would discard work asks first.

**Claude can help, only if you let it.** Two opt-in ways, both through your own [Claude Code](https://claude.com/claude-code) CLI and your own plan (no API key needed):

- **Ask Claude** — when a platform is still missing for a track, one button (`A`) asks Claude to find it. Its answer must pass the platform's own metadata fetch and a confidence check.
- **Chat** (`Ctrl+T`) — talk to Claude about your list: "fix the titles in this playlist", "which of these have no lossless source?". It reads and edits your tracks through a fixed set of typed [tools](docs/agent-tools.md), shows a preview before any batch, can be undone with `/undo`, asks before it downloads anything, and never touches a file itself.

**It is a real keyboard app, and the mouse works too.** Every shortcut can be rebound and the hints on screen always show your live binding. Click, scroll, and drag over any text to copy it. Sessions are saved and re-opened on the next start; you can keep several and archive finished tasks.

**Private by design.** No account, no telemetry. See [Privacy](#privacy) for exactly what is sent where.

## How it works

1. **Paste** a track, album or playlist link. The platform is recognised and the track is read (Spotify, YouTube, SoundCloud, Deezer, Apple Music, Tidal).
2. **Find it elsewhere.** The same track is looked up on every other platform, all at once, through MusicBrainz, plus Songlink if you allowed it. Each platform shows up as a group with a confidence score, and if one is still missing you can ask Claude (opt-in) to look for it.
3. **Find download sources.** yt-dlp and Soulseek each search for a file, and the candidates are listed side by side with their real quality.
4. **Pick one.** Preview the candidates, compare them, and keep the best (it is chosen for you by default, and you can change it).
5. **Save.** The file is converted if you asked for a format (FLAC by default) and written with clean tags and MusicBrainz IDs.

Everything runs as a queue with a configurable number of parallel tasks, so a whole playlist is one paste. When a source can't be found (an unofficial re-upload, say), **paste the right link yourself** onto the track or onto a platform's cell: it is kept for good.

## What it can read, search and download

| Platform                    | Paste a…               | Searched during discovery                  | Downloaded by                       |
| --------------------------- | ---------------------- | ------------------------------------------ | ----------------------------------- |
| **Spotify**                 | track, album, playlist | yes                                        | — (metadata only; Soulseek by name) |
| **YouTube / YouTube Music** | track, playlist        | yes                                        | yt-dlp                              |
| **SoundCloud**              | track, playlist, album | yes                                        | yt-dlp                              |
| **Deezer**                  | track, album, playlist | yes (by ISRC first)                        | — (Soulseek by name)                |
| **Apple Music**             | track, album           | yes                                        | — (Soulseek by name)                |
| **Tidal**                   | track                  | via a pasted link, Songlink or MusicBrainz | — (Soulseek by name)                |

Discovery also uses **MusicBrainz** (on by default), **Songlink** (opt-in) and **Claude** (opt-in, on request). Soulseek is off by default: turn it on in Settings → Download.

Platforms whose streams are protected (Spotify, Deezer, Apple Music, Tidal) are used for what they know best, **metadata**; the audio itself comes from yt-dlp or Soulseek.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/Tetraxel/goblin-malin/main/docs/screenshots/download-view.png" alt="Download view: yt-dlp and Soulseek sources compared, with the saved file pinned on top"/><br/><sub><b>Pick the best source.</b> Real codec, bitrate and size for every candidate, a preview, and the saved file pinned on top.</sub></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/Tetraxel/goblin-malin/main/docs/screenshots/chat.png" alt="The Claude chat panel docked beside the task list"/><br/><sub><b>Chat with Claude</b> (opt-in). It reads and fixes your tracks through typed tools, with a preview and an undo.</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="https://raw.githubusercontent.com/Tetraxel/goblin-malin/main/docs/screenshots/settings.png" width="50%" alt="Settings"/><br/><sub><b>Everything is configurable:</b> providers, formats, folders, concurrency, themes, shortcuts.</sub></td>
  </tr>
</table>

## Install

You need [Node.js](https://nodejs.org/en/download) **22 or newer**.

```bash
npm install -g goblin-malin
goblin-malin
```

<details>
<summary><b>yarn / pnpm</b></summary>

```bash
pnpm add -g goblin-malin
yarn global add goblin-malin
```

> `yarn global` only exists in Yarn 1 (classic). Yarn 2 and newer removed it: use `npm` or `pnpm` instead. Add your `yarn` bin folder to your `PATH` so that `goblin-malin` is found in any terminal (on Windows: `%LOCALAPPDATA%\Yarn\bin`).

</details>

| System      | Status                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** | Supported. `yt-dlp`, `ffmpeg` and `mpv` (for in-app audio preview) are downloaded automatically on first run.                                                                                                                                           |
| **macOS**   | Supported. `yt-dlp` and `ffmpeg` are downloaded automatically (ffmpeg from [evermeet.cx](https://evermeet.cx/ffmpeg/)). For in-app preview, `brew install mpv`.                                                                                         |
| **Linux**   | **Not supported yet.** The app starts, but its automatic `ffmpeg` download fetches a Windows build, so saving tracks does not work (it deliberately never falls back to an `ffmpeg` from your `PATH`). `mpv` is picked up from your `PATH` as on macOS. |

A terminal at least **66 columns** wide is needed; the Claude chat docks beside the list from **108 columns**.

## First run

1. A short **welcome tour** plays (turn it off in Settings → _Show welcome tutorial on start-up_).
2. One screen asks **which download providers** and **which platforms** to use. A grid shows, in each platform's color, whose links each download provider will use; untick a platform and its link greys out. `Enter` ticks a row, `Ctrl+S` saves. Settings → Metadata / Download change it later.
3. The tools it needs (`yt-dlp`, `ffmpeg`, `ffprobe` and, on Windows, `mpv`) are downloaded into the [data folder](#where-your-data-lives); a dialog tells you if one can't be found.
4. Credentials are asked for **when a provider needs them** (or run Settings → _⚙ Setup Wizard_):
    - **Spotify** — your own Spotify API app (client id + secret from the [developer dashboard](https://developer.spotify.com/dashboard); needs a Premium account) for full metadata (album, ISRC, track number), or the no-credentials mode, which reads the public page and gives less.
    - **Soulseek** — your Soulseek username and password.

    They are saved in the `.env` file of the data folder, in plain text. See [.env.example](.env.example).

5. **Songlink** and **Claude** stay off until you allow them once (a dialog explains what is sent).
6. Pick your **output folder** in Settings → Download → _Default output directory_.

## Keyboard

Every shortcut can be rebound in Settings → _Shortcuts_. The essentials:

| Key             | What it does                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Ctrl+V`        | Import the links on the clipboard. On the **Metadata Sources** list or a **platform's cell**, add the link to _that track_.       |
| `↑` `↓` `←` `→` | Move in the task list and between columns                                                                                         |
| `Tab`           | Switch the focused panel                                                                                                          |
| `1` `2`         | Metadata view / Download view                                                                                                     |
| `3` `4` `5`     | Metadata sources / Download sources / Logs                                                                                        |
| `R`             | Start (or restart) the focused task. `F` re-fetches the metadata, `D` re-discovers on the other platforms, `W` searches downloads |
| `Space`         | Play a source (`Ctrl+P` pauses)                                                                                                   |
| `S`             | Save the selected source to the output folder                                                                                     |
| `A`             | Ask Claude to find a missing platform (opt-in)                                                                                    |
| `Ctrl+T`        | Open the Claude chat (opt-in)                                                                                                     |
| `Ctrl+G`        | Group the selected tracks under a name                                                                                            |
| `Ctrl+A`        | Select all tasks; `Ctrl+Shift+↑/↓` extends the selection. Most actions work on the whole selection                                |
| `Del`           | Archive or delete the task                                                                                                        |
| `Ctrl+Q`        | Quit (asks first; `Ctrl+C` does not quit)                                                                                         |

The hints at the bottom of the screen always show the live binding of whatever is focused. **Select any text by dragging over it** and it is copied when you let go (`Alt`+drag takes a rectangle; Settings → General can turn it off). The **Actions** button drops down things to do to the whole list, such as opening every track in MusicBrainz Picard.

## Privacy

There is no telemetry and no account. The app only talks to these services, and only as needed:

| Service                                   | When                                                                                                                         | What is sent                                                                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spotify, YouTube / YouTube Music          | You import a link of that platform, and whenever a download runs (yt-dlp searches and downloads; your `cookies.txt`, if any) | The link, or a search for the track                                                                                                                                         |
| SoundCloud, Deezer, Apple Music, Tidal    | You import a link of that platform, and during discovery (each can be switched off in Settings → Metadata)                   | The link or its id, the track's ISRC, or a search for its artist and title                                                                                                  |
| MusicBrainz                               | Discovery (on by default)                                                                                                    | Track title, artists, ISRC                                                                                                                                                  |
| Soulseek network                          | You enable the Soulseek provider (off by default)                                                                            | Your Soulseek login and the search terms. It is peer-to-peer: the users you download from can see your IP address                                                           |
| `api.github.com`, `github.com`            | At start-up, to **check for a new version** (can be turned off), and to download `yt-dlp`, `ffmpeg` and (on Windows) `mpv`   | A plain request, no data about you                                                                                                                                          |
| **Songlink** (`api.song.link`) — _opt-in_ | After you allowed it                                                                                                         | The link of each track                                                                                                                                                      |
| **Claude** — _opt-in_                     | Only when you click "Ask Claude", or when you chat (after allowing it once)                                                  | Track details (title, artists, album, date, ISRC, duration, link), through the Claude Code CLI on your computer and **your own Claude account** (it uses part of your plan) |

Songlink and Claude stay off until you allow them; you can change your mind in Settings.

## Where your data lives

One folder, which you can move with the `GOBLIN_DATA_DIR` environment variable (set it in your shell, not in `.env`).

| System                               | Default data folder                                           |
| ------------------------------------ | ------------------------------------------------------------- |
| Windows                              | `%APPDATA%\goblin-malin`                                      |
| macOS                                | `~/Library/Application Support/goblin-malin`                  |
| Linux                                | `$XDG_DATA_HOME/goblin-malin` (`~/.local/share/goblin-malin`) |
| Running from source (`yarn run dev`) | `data/` in the repository                                     |

| Inside the folder          | What it is                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| `settings.json`            | Your settings and shortcuts                                                    |
| `sessions.json` (+ `.bak`) | Your task list and sessions                                                    |
| `.env`                     | Spotify and Soulseek credentials, in plain text                                |
| `cache/`                   | Cached provider answers (Settings → _Clear cache_)                             |
| `bin/`                     | Downloaded tools (`yt-dlp`, `ffmpeg`, `ffprobe`, `mpv`) and your `cookies.txt` |
| `app.log`, `app.prev.log`  | The log of this session and of the previous one (also in the Logs tab)         |

Saved tracks go to the _Default output directory_; unsaved downloads wait in the _Temporary download directory_ (Settings → Download). `GOBLIN_NO_AUDIO=1` never starts `mpv` (no preview, no intro sound). Only one Goblin Malin can run per data folder.

## Troubleshooting

<details>
<summary><b>YouTube says "Sign in to confirm you're not a bot", or a download fails with HTTP 403</b></summary>

Give `yt-dlp` your browser's cookies. Settings → Download → YtDlp → _Import cookies.txt…_ walks you through it (export the cookies with a browser extension such as _Get cookies.txt LOCALLY_, drop the file on the terminal, done), or set _Cookies from browser_ to Firefox to let `yt-dlp` read them itself. It is used on the next download; the settings say how old the imported file is, since YouTube signs sessions out after a while.

</details>

<details>
<summary><b>"ffmpeg/yt-dlp could not be found or downloaded"</b></summary>

The dialog says why (usually no network, or a proxy/antivirus blocking the download). Fix the cause and restart the task. On Linux, see [Install](#install).

</details>

<details>
<summary><b>Nothing plays</b></summary>

Preview needs [`mpv`](https://mpv.io/). Windows downloads it for you; on macOS install it so that `mpv` is on your `PATH`. Check that `GOBLIN_NO_AUDIO` is not set.

</details>

<details>
<summary><b>Spotify tracks have no album or ISRC</b></summary>

You are in the no-credentials mode. Run Settings → _⚙ Setup Wizard_ and enter your own Spotify API app.

</details>

<details>
<summary><b>Songlink stops answering</b></summary>

Its free quota is about 19 lookups per hour. Wait, or leave Songlink off for big imports.

</details>

<details>
<summary><b>The layout is garbled, or "Goblin Malin is already running"</b></summary>

Make the terminal at least about 66 columns wide. For the lock, close the other window or, if none is open, delete the lock file the message names.

</details>

Anything else: look at the Logs tab (`5`) or at `app.log`, then [open an issue](https://github.com/Tetraxel/goblin-malin/issues) with the log.

## Contributing

```bash
git clone https://github.com/Tetraxel/goblin-malin && cd goblin-malin
yarn install     # Node 22+ and Yarn 1
yarn run dev     # start the app from source
```

Before sending a change: `yarn run type-check`, `yarn run lint`, `yarn run format:check` and `yarn test`.

- A map of the code: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Adding a platform or a download provider takes one service class and one `register()` call.
- What is built and what is left: [CHANGELOG.md](CHANGELOG.md), [TODO.md](TODO.md) and [docs/projects/](docs/projects/README.md).
- How a release is made: [docs/RELEASING.md](docs/RELEASING.md).

<details>
<summary>Starting the app from JavaScript</summary>

```js
import GoblinMalin from "goblin-malin";

GoblinMalin.start(); // not customizable yet
```

</details>

## License

[PolyForm Noncommercial License 1.0.0](LICENSE): free for personal and other noncommercial use, **not** for commercial use.
