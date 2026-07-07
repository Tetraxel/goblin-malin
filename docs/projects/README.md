# Projects

High-level technical projects needed to reach the target product described in the [root README](../../README.md) and [design screenshots](../designs/).

These are not task lists — each project is a self-contained scope of work. Individual tasks are broken out in each project's subfolder.

## Foundation projects (P1–P20)

The infrastructure wave: input system, layout, import, metadata/download panels, save flow, settings, sessions, logging, test harness, and performance. Largely delivered — see each file for per-task status.

| Project                                          | Tasks                          |
| ------------------------------------------------ | ------------------------------ |
| P1 — Global Keyboard / Input System              | [p1/tasks.md](p1/tasks.md)     |
| P2 — Two-Panel Layout                            | [p2/tasks.md](p2/tasks.md)     |
| P3 — Import System                               | [p3/tasks.md](p3/tasks.md)     |
| P4 — Metadata Source Management Panel            | [p4/tasks.md](p4/tasks.md)     |
| P5 — Download Source Selection & Audio Preview   | [p5/tasks.md](p5/tasks.md)     |
| P6 — Save Flow (Tag & Export)                    | [p6/tasks.md](p6/tasks.md)     |
| P7 — Settings System                             | [p7/tasks.md](p7/tasks.md)     |
| P8 — Provider Display Registry                   | [p8/tasks.md](p8/tasks.md)     |
| P9 — Color Theme Unification                     | [p9/tasks.md](p9/tasks.md)     |
| P10 — Setup Wizard per Provider                  | [p10/tasks.md](p10/tasks.md)   |
| P11 — Songlink and new metadata structure        | [p11/tasks.md](p11/tasks.md)   |
| P12 — Global Input System                        | [p12/tasks.md](p12/tasks.md)   |
| P13 — Session management                         | [p13/tasks.md](p13/tasks.md)   |
| P14 — Spotify auth-mode choice & scrape fallback | [p14/tasks.md](p14/tasks.md)   |
| P15 — URI parsing on import                      | [p15/tasks.md](p15/tasks.md)   |
| P16 — Logging Revamp                             | [p16/tasks.md](p16/tasks.md)   |
| P17 — TUI Test Harness                           | [p17/tasks.md](p17/tasks.md)   |
| P18 — Component Render Profiling                 | [p18/tasks.md](p18/tasks.md)   |
| P19 — Scroll & Render Performance                | [p19/tasks.md](p19/tasks.md)   |
| P20 — Performance & Scalability Roadmap          | [p20/tasks.md](p20/tasks.md)   |
| P20b — Remove the Flow Abstraction               | [p20b/tasks.md](p20b/tasks.md) |

## Product projects (P21–P28) — proposed

The product wave: with the foundation in place, these projects target what users actually feel — release blockers, workflow multipliers, audio quality, and trust. Each plan is grounded in the current code (file paths, contracts, known bugs) and follows the provider-extensibility and shortcuts philosophies from [CLAUDE.md](../../CLAUDE.md).

| Project                                       | User value                                                                                                                                                              | Tasks                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| P21 — Playlist & Album Import                 | Paste one playlist/album URL → import all its tracks. Today collection URLs become dead "Unknown" tasks.                                                                | [p21/tasks.md](p21/tasks.md) |
| P22 — Soulseek Provider & Quality Honesty     | A true-lossless download source (revives the dead `SoulseekService`), plus honest codec/provenance labels — yt-dlp "FLAC" is transcoded Opus and the UI should say so.  | [p22/tasks.md](p22/tasks.md) |
| P23 — Music Library & Duplicate Detection     | A persistent index of saved tracks: "already saved" warnings at import, find/relocate files, batch open in Picard.                                                      | [p23/tasks.md](p23/tasks.md) |
| P24 — First-Run Experience & Setup Doctor     | Diagnose-and-fix checks for yt-dlp/ffmpeg/mpv/cookies/credentials, a guided cookies wizard, and a real path picker. Clears 2 release blockers + the top silent failure. | [p24/tasks.md](p24/tasks.md) |
| P25 — Per-Service Status                      | Every provider reports its own live status instead of overwriting one shared task status. Clears a release blocker.                                                     | [p25/tasks.md](p25/tasks.md) |
| P26 — Search-Based & Text Import              | Import without URLs: type a song name, or paste tracklists / M3U / rekordbox CSV — with confidence-gated auto-match.                                                    | [p26/tasks.md](p26/tasks.md) |
| P27 — Audio Verification & Auto-MB IDs        | Catch wrong downloads (live versions, DJ sets) via duration + optional acoustic fingerprint; auto-fill missing MusicBrainz release IDs (release blocker).               | [p27/tasks.md](p27/tasks.md) |
| P28 — Provider Expansion: Deezer & SoundCloud | Deezer metadata/discovery (keyless API, fills the empty BPM column via ISRC lookup) and SoundCloud import + direct download.                                            | [p28/tasks.md](p28/tasks.md) |

### Recommended order

1. **P20b** ✅ (done) — the flow-abstraction removal landed first: it rewired the seams every other project builds on (task creation, contextual actions, settings items), so the features below build directly on the de-classed modules.
2. **P25** then **P24** — the release blockers. P25 is small and structural (one wiring change in `ServiceBase` + an aggregate); P24 makes the app installable by strangers and turns the #1 silent failure (stale cookies) into a guided fix.
3. **P21** — the biggest workflow multiplier; independent of everything else.
4. **P22** — the biggest quality win, and the first real second download provider exercising the P5 panel.
5. **P23** — becomes important the moment P21 makes bulk imports easy (re-imported playlists must not re-download).
6. **P26**, **P28**, **P27** — in any order; P27 benefits from P22's shared ffprobe work and P24's doctor, P28 benefits from P22's provenance labels.

Cross-project seams to keep in mind: the ffprobe file probe is shared by P22/T22.5 and P27/T27.1 (build once); the doctor (P24) hosts the optional-binary checks P27 needs; P21's collection contract is where SoundCloud sets (P28) plug in later.
