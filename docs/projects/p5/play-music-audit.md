# Audio Playback in a Node.js + TypeScript + Ink Terminal App: Solutions Compared

**TL;DR**

- **Use mpv as a persistent background process and control it via JSON IPC** (the `node-mpv` v2 wrapper, or a thin custom client over the Unix socket / Windows named pipe). It is the only mainstream Node-friendly approach that gives you MP3/FLAC/AAC/OGG decoding, accurate seek, gapless pause/resume, per-track volume, and metadata events with sub‑100 ms reactivity, on macOS, Linux, and Windows, without you having to write a decode pipeline.
- **The pure-Node native-binding path (node-speaker + a decoder, naudiodon, miniaudio bindings, audify) is viable but significantly more work** — none of those packages decode compressed audio + give you proper seek out of the box; you have to wire up `node-lame`/`flac`/`music-metadata` plus your own seek-by-offset logic, and the most popular pieces (node-speaker, naudiodon) have not had a real release in 2–4 years.
- **Avoid anything that shells out per action** (`play-sound`, `sound-play`, plain `child_process.spawn(ffplay, ...)`). Spawn cost (50–500 ms cold start, plus audio-device init), no pause/seek, and broken UX during Ink re-renders disqualify them for an interactive TUI.

---

## Key Findings

1. **mpv + JSON IPC is the de‑facto solution for "real player in a Node app".** mpv runs in `--idle` mode in the background; a single Unix domain socket (`--input-ipc-server=/tmp/mpv.sock`, or `\\.\pipe\…` on Windows) accepts newline‑delimited JSON commands like `{"command":["loadfile","song.mp3"]}`, `{"command":["set_property","pause",true]}`, `{"command":["seek",30,"absolute"]}`, `{"command":["set_property","volume",70]}`. Round‑trip latency is dominated by socket I/O (typically <5 ms) and mpv's seek implementation (precise audio seek in MP3/FLAC is generally well under 100 ms). mpv handles MP3, FLAC, AAC, OGG/Opus, ALAC, WAV, etc. through its embedded FFmpeg.

2. **`node-mpv` (j-holub) is the most complete wrapper** — 297 commits, ~129 stars, MIT, ships `index.d.ts` TypeScript declarations in‑repo, exposes `start()`, `load()`, `pause()`, `resume()`, `seek()`, `goToPosition()`, `volume()`, `mute()`, `getProperty()`, `observeProperty()`, plus a generic `commandJSON()` escape hatch. v2 is async/Promise‑based; it has been "in beta" for ~3 years but is widely used in production (e.g., Karaoke Mugen / Electron). v1 is on npm under `node-mpv`; v2 is at the master branch. Caveat: maintenance has been sporadic since 2022, and several issues (Windows pipe edge cases, occasional restart bugs) remain open. It's still the path of least resistance.

3. **`mpv-ipc` and direct‑socket DIY are the safer long‑term route.** mpv's IPC protocol is stable and documented (https://mpv.io/manual/master/#json-ipc). Writing ~100 lines that opens the socket, queues commands, and dispatches `event`/`property-change` messages gives you a wrapper you fully own and that can't go stale — recommended once you understand the protocol if you want to avoid the maintenance risk in `node-mpv`. The npm package `mpv-ipc` (`MPVClient(socketPath)`) is a minimal example of this style.

4. **node-speaker (TooTallNate) is alive but sparsely maintained.** Last published 0.5.5 ~2 years ago; 687 stars; multiple open bug reports as recent as Jan 2026 (#188), Dec 2024, Nov 2024. It's a _PCM sink_ only — it accepts raw interleaved PCM and routes to ALSA/CoreAudio/winmm via mpg123's output modules. To play an MP3 you must pair it with `node-lame`/`@suldashi/lame`; for FLAC there is no widely‑maintained Node decoder. Pause is "unpipe and start buffering ~500 ms of underflow warnings", and **seek requires you to re‑decode from a calculated byte offset** — there is no native seek primitive. This is fine for a streaming radio bot, painful for a music player.

5. **naudiodon (Streampunk PortAudio bindings) is essentially abandoned for app use.** Last npm release `2.3.6` was ~4 years ago; the README explicitly says "development is not yet complete… recommended for development environments and prototypes". Same architecture as node-speaker: PCM in, no decoding, no seek. There's a fork `naudiodon2` (csukuangfj) targeting newer Node versions but with the same scope.

6. **audify is healthy but not actually a media player.** Active, prebuilt N‑API binaries for Node 12+ / Electron 8+, MIT, used by VS Code extensions. But it is RtAudio (low‑level PCM I/O) plus Opus encode/decode only — no MP3/FLAC. It would only help you as the output sink in a custom decode pipeline, not as a player.

7. **miniaudio bindings for Node exist but are immature.** miniaudio (the C library) decodes WAV/MP3/FLAC natively and has a high‑level engine API with pause/seek/volume/spatial. Node bindings are fragmented:
   - `@thesusheer/node-miniaudio` — single `playAudio(path, callback)` function only; no pause/seek; targeted at notification sounds.
   - `YXL76/neon-miniaudio` — has `load/play/pause/stop/volume/isPlaying`, no seek API exposed; ~5 yrs since last meaningful update.
   - `audio-speaker` (audiojs) — uses miniaudio as one of several backends but is a PCM sink, not a player.
     None expose miniaudio's `ma_sound_seek_to_pcm_frame`, so you'd be writing your own bindings to get true seek.

8. **Web Audio API in Node is now real.** Two options:
   - **`web-audio-api` (audiojs)** — **pure JS**, no native deps, 100% WPT conformance, last published 8 days before this report (1.3.2). Decodes MP3/FLAC/OGG/AAC via `audio-decode`. Caveat: pause/seek on `AudioBufferSourceNode` follow the W3C contract, so you implement seek by `stop()` + creating a new source at the desired offset (a few ms of work). DSP is 2–4× slower than native for heavy effects but trivially fast enough for plain playback.
   - **`node-web-audio-api` (ircam-ismm)** — Rust napi bindings to a real Web‑Audio implementation, prebuilt binaries for major platforms; needs `libasound2-dev` to build from source on Linux. Same seek caveat.
     Both are a clean path if you want zero external binaries and don't mind writing a tiny "PlaybackSession" wrapper that tracks the current offset.

9. **ffplay as a long‑running process is a dead end for programmatic control.** Its keyboard interface (space, arrow keys, mouse click‑to‑seek) is interactive‑terminal‑bound; there is no JSON or stdin command protocol. You can technically inject keypresses, but it's brittle and there is no event channel back. ffmpeg itself is a transcoder, not a player; using it as a persistent decoder piped into node-speaker is _possible_, and it is in fact what some Discord music bots do for streaming, but it's a worse engineering trade than just using mpv.

10. **`play-sound`, `sound-play`, `terminal-music-player` all spawn a child process per action.** They wrap `afplay` / `mplayer` / PowerShell / `mpv`. Cold spawn is 50–500 ms, audio‑device acquisition adds more, you get no seek, and pausing means killing the process. Disqualified by your reactivity constraint.

11. **`@discordjs/opus`, `prism-media`** — Opus‑specific, designed for Discord voice; not relevant unless your library is Opus.

12. **`node-rodio`** — Rust Rodio bindings via Neon. Last release 6 years ago, last commit 2018. Don't use.

---

## Details

### Comparison matrix

| Solution                                  | Persistent process       | Decodes MP3/FLAC/AAC/OGG                 | Native seek                                | Pause/Resume                                  | Volume                   | <100 ms reactivity       | TypeScript                        | Cross‑platform                 | Maintenance signal                                                                      |
| ----------------------------------------- | ------------------------ | ---------------------------------------- | ------------------------------------------ | --------------------------------------------- | ------------------------ | ------------------------ | --------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| **mpv via node-mpv (or direct IPC)**      | Yes (one mpv child)      | Yes (FFmpeg inside mpv)                  | Yes (precise + keyframe)                   | Yes                                           | Yes (0–100 + replaygain) | Yes                      | Bundled `index.d.ts`; IPC is JSON | macOS/Linux/Windows            | mpv itself: very active. node-mpv: usable but slow, last release ~2022; v2 in long beta |
| **node-web-audio-api (ircam-ismm, Rust)** | Yes (in‑process)         | Yes (via decodeAudioData)                | Manual (recreate source at offset)         | Manual via `suspend`/`resume` ctx             | Yes (GainNode)           | Yes                      | Yes                               | macOS/Linux/Windows (prebuilt) | Active                                                                                  |
| **web-audio-api (audiojs, pure JS)**      | Yes (in‑process)         | Yes (audio-decode: WAV/MP3/FLAC/OGG/AAC) | Manual (recreate source)                   | Manual via ctx suspend/resume                 | Yes                      | Yes                      | Yes                               | Any Node ≥18                   | Very active (1.3.2, May 2026)                                                           |
| **node-speaker + node-lame**              | Yes (streaming pipeline) | MP3 only (no FLAC decoder maintained)    | No (DIY by byte offset)                    | Yes via stream.pause but ~500 ms buffer drain | Software gain only       | Slow on pause/seek       | Community types                   | macOS/Linux/Windows            | Mixed; speaker has open bugs, no recent releases                                        |
| **naudiodon (PortAudio)**                 | Yes                      | No (PCM only)                            | No                                         | Yes                                           | Software                 | Yes once decoded         | Yes (.d.ts in repo)               | Yes                            | Stalled; "for prototypes"                                                               |
| **audify (RtAudio)**                      | Yes                      | No (Opus only)                           | No                                         | Yes                                           | Software                 | Yes                      | Yes                               | Yes                            | Active                                                                                  |
| **miniaudio bindings**                    | Yes                      | Yes (WAV/MP3/FLAC)                       | Library supports it; bindings don't expose | Partial                                       | Yes                      | Yes                      | Mostly community                  | Yes                            | Fragmented                                                                              |
| **ffplay child process**                  | Yes                      | Yes                                      | Only via TTY keys                          | Only via TTY keys                             | Only via TTY keys        | No (no IPC)              | n/a                               | Yes                            | n/a                                                                                     |
| **play-sound / sound-play**               | **No (spawn per play)**  | Depends on host player                   | No                                         | No (kill only)                                | No                       | **No (50–500 ms spawn)** | n/a                               | Yes                            | n/a                                                                                     |

### How the mpv IPC approach actually performs

You spawn mpv once at app start:

```
mpv --idle --no-video --no-terminal --input-ipc-server=/tmp/inkplayer.sock
```

Then over a `net.createConnection('/tmp/inkplayer.sock')` you write newline‑delimited JSON. Every command returns a JSON `{"request_id":N,"error":"success"}`; `event`/`property-change` messages stream asynchronously. Round‑trip on a local socket on a modern machine is ~1 ms. mpv's `seek` with `--hr-seek=yes` is precise to the audio frame; for typical MP3/FLAC the audible jump is dominated by audio‑device buffer drain (10–50 ms) plus decoder ramp‑up — well inside your <100 ms budget. `pause` is property‑set — instantaneous to the ear. `volume` is also instantaneous (mpv applies it in the audio filter chain).

Practical Ink integration pattern that works well: keep the mpv socket client in a singleton outside React, expose it via a Zustand/Jotai store or a React context, and have your `useInput` handlers call `mpv.seek(±5)` / `mpv.cycle('pause')` directly. Subscribe to mpv's `time-pos` and `pause` properties via `observe_property` and feed them into store state so the Ink progress bar repaints at whatever cadence you choose (mpv emits `property-change` for `time-pos` ~4× per second by default; bump it with `--observed-property-poll-time` or just throttle in JS).

### Why not just node-speaker + decoder?

It's a perfectly reasonable pure‑Node setup _if_ you only need MP3 streams and never seek. The moment you want FLAC, AAC, or seek‑by‑timestamp, you're rebuilding what mpv already does:

- No actively maintained Node FLAC decoder. `flac-bindings` exists but is little‑used.
- Seeking an MP3 by timestamp requires either a Xing/VBR header table or a full pre‑scan; node-lame doesn't help.
- Pause is "unpipe and let mpg123 underflow," which floods stderr with `Didn't have any audio data in callback` (this is a long‑standing real bug, see node-speaker issue #92). You can hack around it, but it's noisy.

### Why not Web Audio in Node?

It's actually a strong second choice — particularly `web-audio-api` (audiojs, pure JS) because there's nothing to compile and you stay 100% Node. Tradeoffs:

- You have to implement a "playback session" abstraction yourself: load → decodeAudioData → AudioBufferSourceNode → connect through a GainNode → `start(0, offset)`; pause = remember `ctx.currentTime - playStartedAt + offset`, then `source.stop()`; resume = new source with the saved offset; seek = same as resume with new offset. That's ~50 lines of TypeScript and gives you sample‑accurate control.
- For very large FLAC files, the whole decoded buffer sits in RAM (decode‑then‑play model). For a music player playing one track at a time that is fine; for huge mixes it isn't.
- The audiojs version is reported as "all scenarios render faster than real‑time, pure JS matches Rust napi on simple graphs" by its own maintainers — i.e., trust the perf for plain playback, be skeptical for heavy DSP claims.

### What about libmpv directly?

Going via `node-ffi-napi` to libmpv is technically possible (and gives you in‑process control without a child process) but `ffi-napi` itself is poorly maintained on modern Node, and you lose the only real reason to choose libmpv over the IPC path: there's no measurable latency difference for an audio‑only player. Skip it.

---

## Recommendations

### Stage 1 — ship the MVP (1–2 days of work)

**Use mpv via JSON IPC.** Concretely:

1. Make mpv a hard runtime dependency. Detect it at startup; if missing, print install instructions (`brew install mpv` / `apt install mpv` / `winget install mpv`) and exit gracefully.
2. Start with **`node-mpv` v2** (`npm install node-mpv@beta`) for the first iteration. It will get you `load/pause/resume/seek/volume/observeProperty` in a couple of hours and ships its own `.d.ts`.
3. Wrap it in a small `PlayerService` class that exposes a domain‑shaped API (`play(path)`, `togglePause()`, `seekRelative(±s)`, `setVolume(0..1)`, `getStatus(): {position,duration,paused,volume}`, plus `on('progress'|'ended'|'error', …)`). The Ink layer should never touch `node-mpv` directly — this insulates you against switching the backend later.
4. For metadata (title/artist/album/duration), use **`music-metadata`** (`Borewit/music-metadata`) — actively maintained, ESM, supports MP3/FLAC/AAC/OGG/etc., returns `IAudioMetadata` with full TypeScript types. Don't rely on mpv for this; parse the file once at enqueue time.
5. Throttle `time-pos` updates into your Ink store at ~4–10 Hz max; otherwise React re‑renders dominate CPU.

### Stage 2 — harden (when you hit real users)

- **If `node-mpv` bites you** (it will eventually — a Windows pipe edge case, a v2 beta API change, a stalled PR), replace it with ~150 lines of your own IPC client. mpv's protocol is small and stable; the mpv-ipc package can serve as a starting point. This drops your only fragile dependency.
- Add a fallback path: if mpv is not installed and the user can't install it, fall back to `web-audio-api` (audiojs) for at least MP3/WAV. This gives you "always works, just degraded." Gate it behind a config flag.
- Pin `--hr-seek=yes` and `--cache=no` (or a small cache) for snappy local‑file seeks. For network sources, pin `--cache=yes --cache-secs=10`.

---

## What Was Actually Built

`node-mpv` was skipped entirely. Stage 2 (direct IPC client) was implemented from the start.

**`src/utils/mpvPlayer.ts`** — `MpvPlayer` class (~270 lines) extending `EventEmitter`. Opens a `net.Socket` to the mpv IPC server, queues JSON commands with request IDs and 5 s timeouts, and dispatches `property-change` / `start-file` / `end-file` events. Public API: `play(filePath)`, `stop()`, `togglePause()`, `seekMs(ms)`, `setVolume(percent)`, `getStatus()`. Emits `progress`, `stateChange`, `ended`, `error`. Exported as a singleton via `getInstance()`.

**`src/utils/mpv-setup.ts`** — `ensureMpv()` handles the binary. On macOS/Linux it returns `"mpv"` (system PATH). On Windows it auto-downloads a versioned portable binary from **shinchiro/mpv-winbuild-cmake** GitHub releases (via the GitHub API), extracts `mpv.exe` from the `.7z` archive using `7zip-bin`, caches it in `BIN_DIR` as `mpv_<version>.exe`, and cleans up older versions on upgrade. No manual install step is needed on Windows; other platforms still require a system `mpv`.

The IPC socket path follows the cross-platform split noted in finding #1: a Unix domain socket on macOS/Linux, a Windows named pipe (`\\.\pipe\mpv-ipc-<pid>`) on Windows with the name-only form passed to `--input-ipc-server` (mpv prepends `\\.\pipe\` itself).

The `PlayerService` abstraction from Stage 1 recommendation #3 maps directly to `MpvPlayer`: `DownloadSourceDetail` and `DownloadSourceTree` call `getInstance()` and never interact with the socket or mpv process directly.

### Stage 3 — only if you need to drop the external binary

If shipping mpv as a dependency becomes a deal‑breaker (e.g., you need `npx` zero‑install UX), migrate the whole `PlayerService` to **`node-web-audio-api`** (Rust napi, prebuilt) or **`web-audio-api`** (pure JS). Because Stage 1 hid the backend behind your service, this should be a localized change. You'll write a `PlaybackSession` object that owns `currentOffset`, the active `AudioBufferSourceNode`, and a `GainNode`, and that re‑creates the source on seek.

### Benchmarks / thresholds that should change the recommendation

- If pause/seek is measurably > 100 ms on the reference target machine in a real test, you have a buffering/decoder issue, not a Node↔mpv issue. Fix the mpv flags before changing the architecture.
- If users complain about "mpv must be installed", that's the trigger for Stage 3, not before.
- If you ever need >2 simultaneous streams (mixing, crossfade, ducking), drop mpv and go to `node-web-audio-api` — the Web Audio graph is the right model for that and mpv is awkward at it.

---

## Caveats

- **`node-mpv` v2 has been "beta" since ~2021** and the repository's commit cadence is low (last meaningful releases were 1.5.0 in 2018 for v1; v2 master has had sporadic commits since). It works, lots of people ship it, but treat it as something you may eventually fork or replace with a direct‑IPC client. The risk is _maintenance_, not _correctness_.
- **The mpv IPC protocol itself is stable** and well‑documented; your direct‑IPC fallback is therefore low‑risk.
- **node-speaker open issues with bug reports as recent as January 2026** suggest it works for the common case but has rough edges around teardown and underflow on macOS that you will hit in a TUI app where pause is frequent.
- **naudiodon's own README disclaims production readiness** and the last release is ~4 years old; do not pick it for new work.
- **Latency numbers in this report are based on documented behavior of mpv's IPC and the Web Audio API, not on benchmarks I ran.** Your machine, OS audio stack (PulseAudio vs PipeWire vs CoreAudio vs WASAPI), and buffer settings will dominate; always measure on your reference hardware before locking in.
- **macOS Apple Silicon and Linux ARM64**: mpv has prebuilt binaries on all platforms and arches you'll care about; native bindings (naudiodon, audify, node-speaker) are the ones most likely to fail to build on a fresh ARM64 machine, which is another point in favor of the mpv approach.
- **Ink + frequent state updates**: if you tie progress‑bar repaints directly to mpv's `time-pos` events (~4 Hz default, can go higher), you can saturate the renderer. Throttle in the service layer, not in the component.
- I did not find evidence of a single mature, actively‑maintained npm package that does "play any common compressed audio file with seek and pause as a single in‑process API call" — every option requires either an external binary (mpv: best) or composing a small playback‑session on top of Web Audio. Choose accordingly.
