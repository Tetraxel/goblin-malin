# P22 — Soulseek Provider & Source Quality Honesty: Tasks

## Context

**The product promise is "find the best audio source" — today there is only one source, and it isn't what it claims to be.**

- [YtDlpService](../../../src/flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService.ts) downloads with `format: "flac"` — but YouTube serves Opus at ~130 kbps. The resulting file is a **lossless container of lossy audio**. The UI shows "FLAC" with no qualification, which overstates quality to exactly the audience (taggers, DJs, collectors) this app targets.
- [SoulseekService.ts](../../../src/flows/musicDownloadFlow/services/download-providers/soulseek/SoulseekService.ts) is 262 lines of **fully commented-out** code written against a pre-refactor interface (`searchMusic`/`tryDownload` with `@Cached()`), while the current [DownloadService](../../../src/flows/musicDownloadFlow/downloadService.ts) contract is `downloadTrack(trackMetadata, onUpdate?, signal?) → TrackDownloadSource` + `compatibleMetadataProviders`. Soulseek is where true lossless files come from — it's also a TODO.md release-backlog item.
- The good news: the dead code contains a working, tuned **result-scoring heuristic** (size/bitrate/speed weighting, extended-mix bonuses) worth carrying over, `slsk-client` is already a dependency, and the P5 download panel (source tree grouped by provider, diff view, exclusive selection) was built for multiple providers and has never had a second one to show.

Two halves, one goal: **a second, higher-quality source — and honest labeling of every source.**

---

## Tasks

### T22.1 — Rewrite `SoulseekService` against the current contract

New implementation (delete the commented block):

- `compatibleMetadataProviders`: all registered API providers — Soulseek searches by artist/title text, so it can serve any metadata source. Implement by overriding `canDownload()` to `true` (with a duration sanity requirement, see T22.3).
- `downloadTrack(trackMetadata, onUpdate, signal)`:
    1. Connect (once, shared client) using `SOULSEEK_USERNAME` / `SOULSEEK_PASSWORD` via `this.env.getVariable` — guarded by the existing `runExclusive("init", …)` pattern.
    2. Search `"{artist} {title} .flac"` (then `.mp3` fallback if enabled) with `cleanSearchTerm` carried over from the dead code.
    3. Rank with the carried-over `calculateResultWeight` (slots, size, bitrate, speed, extended/club-mix bonuses); keep top `MAX_DOWNLOAD_ATTEMPTS`.
    4. Attempt downloads sequentially; emit `onUpdate` with `state: "searching"` → `"downloading"` + progress; honor `signal` (abort → clean partial file, `state: "failed"`).
    5. On success: populate `localFile`, run `readFileInfo` ([readFileInfo.ts](../../../src/flows/musicDownloadFlow/utils/readFileInfo.ts)) like YtDlp does, return the source.
- Download dir: `soulseek-download/` under `DEFAULT_APP_DATA_DIR` (the dead code used `PROJECT_ROOT` — wrong for installed users).

_Depends on: nothing_

---

### T22.2 — Setup wizard for Soulseek credentials

A `SetupWizardConfig` ([setupWizard.ts](../../../src/base/setupWizard.ts)) registered on the provider settings row (same wiring as Spotify's wizard in `buildFlowSettingsItems`):

- Description blocks: what Soulseek is, that any username/password self-registers on first connect, legal note.
- Fields: `SOULSEEK_USERNAME`, `SOULSEEK_PASSWORD` (required), saved under an `envSection: { name: "Soulseek" }`.
- Provider default `enabled: false`; the wizard's completion enables it (mirrors the enable-after-setup flow other providers use).

_Depends on: T22.1_

---

### T22.3 — Robustness

- Connect timeout + one automatic reconnect on stale/dead client before failing the task.
- Per-search timeout as a provider setting (`searchTimeoutMs`, default 5000 — the dead code's `waitTimeMs`).
- Candidate filter: require duration within ±10 s of the metadata duration when the peer reports it (avoids album-mix/DJ-set files); require free upload slots.
- Peer disconnect mid-download → delete partial file, try next ranked candidate; only fail after the list is exhausted. `"0 results"` is a normal terminal source state (`state: "failed"`, message "No results"), not an exception.

_Depends on: T22.1_

---

### T22.4 — Register the provider

- `this.downloadServiceRegistry.register("soulseek", SoulseekService)` in [musicDownloadFlow.ts](../../../src/flows/musicDownloadFlow/musicDownloadFlow.ts) — per the extensibility philosophy this should be the **only** core change; the download-mode column, settings row, and DownloadPanel provider grouping must appear automatically. Any place that needs a third change is an extensibility bug: fix the registry, not the call-site.
- Verify the P5 tree renders two provider groups and exclusive selection works across providers.

_Depends on: T22.1, T22.2_

---

### T22.5 — Codec provenance ("honesty layer")

Extend `FileInfo` ([types.ts](../../../src/flows/musicDownloadFlow/types.ts)):

```typescript
type FileInfo = {
    // …existing…
    codec?: string;                 // "flac", "mp3", "opus"
    bitrateKbps?: number;           // real, probed
    provenance?: "lossless" | "lossy-transcode" | "lossy";
};
```

- Probe with ffprobe (ships alongside the ffmpeg that yt-dlp conversion already requires) in `readFileInfo` — real codec, bitrate, and duration (also fixes the P5/T5.2 duration-fallback deviation; shared with P27/T27.1).
- **yt-dlp sources are hard-marked `lossy-transcode`** (we *know* YouTube's source is Opus regardless of the FLAC container). Soulseek FLACs are `lossless`; MP3s are `lossy` with the probed bitrate.
- Display: `SourceFileRow` badge (`FLAC` green for lossless, `FLAC*` yellow for transcode, `MP3 320` for lossy) and a `DownloadSourceDetail` line — "FLAC (transcoded from Opus ~130 kbps)". Colors via theme tokens, labels via a single formatter (no per-component logic).

_Depends on: T22.1_

---

### T22.6 — Auto-selection policy

- In `startDownloads`, the auto-`selected` source prefers, in order: `lossless` → highest `bitrateKbps` lossy → transcode. Governed by a new download setting `preferLossless` (default on).
- The P5 diff view already handles "user switches source after save" — no changes needed, verify with the scenario in T22.7.

_Depends on: T22.5_

---

### T22.7 — Tests

- Unit: scoring/ranking (carried heuristics get their first tests), duration filter, provenance mapping, auto-selection policy.
- Mocked `slsk-client` for connect/search/download state machines (timeout, mid-download disconnect, abort).
- TUI harness: fixture download service exposing two providers → tree grouping, badges, diff-on-switch.

_Depends on: T22.1–T22.6_

---

## Summary

| Task  | What                                                                | Depends on   |
| ----- | ------------------------------------------------------------------- | ------------ |
| T22.1 | Rewrite `SoulseekService` on the current `DownloadService` contract | —            |
| T22.2 | Credentials setup wizard + enable-after-setup                       | T22.1        |
| T22.3 | Timeouts, reconnect, duration filter, candidate fallback            | T22.1        |
| T22.4 | Single-line registration; verify zero component changes             | T22.1, T22.2 |
| T22.5 | `FileInfo` provenance + ffprobe + honest badges                     | T22.1        |
| T22.6 | Lossless-first auto-selection (`preferLossless`)                    | T22.5        |
| T22.7 | Unit + mocked-client + TUI-harness coverage                         | T22.1–T22.6  |
