# P27 — Audio Verification & Auto-MusicBrainz IDs: Tasks

## Context

**Nothing verifies that the downloaded audio is actually the requested track.** yt-dlp downloads whatever the YouTube search ranked first — routinely a live version, a sped-up re-upload, a fan edit, or a full DJ set containing the track. The app then tags that wrong audio with pristine metadata and saves it, which is the worst possible outcome for a tagging tool: **a well-labeled wrong file** the user only discovers much later, mid-set or mid-listen.

Current blind spots:

- `readFileInfo` ([readFileInfo.ts](../../../src/flows/musicDownloadFlow/utils/readFileInfo.ts)) can't read the real duration from FLAC (`flac-tagger` limitation, documented P5/T5.2 deviation) — it stores the *metadata* duration as `durationMs`. The one signal that would catch most wrong matches is currently faked to always agree.
- Release blocker (TODO.md): *"Set MusicBrainzReleaseId"* — MB release IDs are missing from tags when discovery didn't resolve them; fingerprinting resolves recordings even when text search fails.

This project adds a verification verdict per download source — cheap duration check always, opt-in acoustic fingerprint (AcoustID/Chromaprint) for certainty — and uses the fingerprint result to complete missing MusicBrainz IDs.

---

## Tasks

### T27.1 — Real duration & codec probe (shared with P22/T22.5)

Replace the duration fallback in `readFileInfo` with an ffprobe call (ffmpeg is already a hard dependency of the FLAC conversion path; the doctor — P24 — checks it): real `durationMs`, `codec`, `bitrateKbps`. If P22 lands first this task is already done; the two projects share one probe implementation.

_Depends on: nothing (coordinates with P22/T22.5)_

---

### T27.2 — Duration verdict on `TrackDownloadSource`

```typescript
type Verification = {
    verdict: "verified" | "suspect" | "mismatch" | "unverified";
    durationDeltaMs?: number;
    method: "duration" | "fingerprint";
    checkedAt: Date;
};
// TrackDownloadSource gains: verification?: Verification
```

- Computed right after `fileInfo` is populated: compare probed duration vs compiled-metadata duration. Thresholds: ≤3 s → `verified`, ≤10 s → `suspect`, otherwise `mismatch` (a 62-minute file for a 3-minute track is caught instantly).
- Display: verdict glyph in `SourceFileRow` (`✓` green / `~` yellow / `✗` red) and a line in `DownloadSourceDetail` ("Duration differs by 4:12 from metadata — likely wrong match"). Add `reviveTaskDates` handling for `checkedAt`.
- Auto-selection (P22/T22.6 policy if present, else `startDownloads`) never auto-selects a `mismatch` source when an alternative exists.

_Depends on: T27.1_

---

### T27.3 — Chromaprint fingerprint + AcoustID lookup (opt-in)

- `fpcalc` (Chromaprint's CLI) becomes an **optional** managed binary: a doctor check (P24) with an auto-download fix, and a `verification.fingerprintEnabled` setting (default off until the binary is present — enabling it from settings triggers the doctor fix).
- `src/flows/musicDownloadFlow/utils/fingerprint.ts`: run `fpcalc -json` on the downloaded file → fingerprint + duration → query the AcoustID API (free API key, stored as `ACOUSTID_API_KEY` via a minimal wizard; the app can ship a registered application key as default) → MusicBrainz recording IDs with match scores.
- Verdict upgrade: recording ID matches the one discovery found (or the ISRC-linked recording) → `verified (fingerprint)` — certainty even when durations coincidentally agree; a confident *different* recording → `mismatch` with both titles shown in the detail panel.
- Runs post-download through its own small semaphore (CPU-bound), status via the service status (P25) when available.

_Depends on: T27.1; coordinates with P24 (doctor), P25 (status)_

---

### T27.4 — MusicBrainz release-ID completion (release blocker)

When a recording ID is known (from fingerprint T27.3, or from the existing MusicBrainz discovery/ISRC path) but release-level IDs are missing from compiled metadata:

- Query the recording's releases via the existing [musicbrainz-client.ts](../../../src/flows/musicDownloadFlow/services/apis/musicbrainz-client.ts); pick by heuristic: release whose title matches the compiled album name → official over bootleg → earliest date. Fill `release`, `releaseGroup` (and `artist` when absent) into the MusicBrainz IDs consumed by `compiledMetadataToTags`, so `saveTrack()` embeds complete `MUSICBRAINZ_*` tags — closing the TODO blocker.
- Shown in the metadata panel's MusicBrainz section as a derived source line (so the user can see where the IDs came from and reject them like any source).

_Depends on: T27.3 (fingerprint path); the ISRC path only needs the heuristic_

---

### T27.5 — Save gate

Setting `verification.warnOnUnverifiedSave` (default on): `saveTrack()` triggered on a `mismatch`/`suspect` source opens the existing ConfirmModal ("Audio verification failed — duration differs by 4:12. Save anyway?"). Never blocks silently; `verified`/`unverified` sources save as today.

_Depends on: T27.2_

---

### T27.6 — Tests

- Unit: verdict thresholds matrix; release-pick heuristic against recorded MB fixtures; fpcalc JSON parsing; AcoustID response mapping (mocked HTTP).
- TUI harness: fixture with a mismatched-duration source → red glyph + save-gate confirm scenario.

_Depends on: T27.2–T27.5_

---

## Summary

| Task  | What                                                        | Depends on |
| ----- | ------------------------------------------------------------ | ---------- |
| T27.1 | Real ffprobe duration/codec (fixes P5 deviation)             | —          |
| T27.2 | Duration verdict + glyphs + auto-select guard                | T27.1      |
| T27.3 | Opt-in Chromaprint/AcoustID fingerprint verification         | T27.1      |
| T27.4 | Fill missing MB release IDs (release blocker)                | T27.3      |
| T27.5 | Confirm-gate on saving unverified audio                      | T27.2      |
| T27.6 | Threshold/heuristic tests + TUI scenario                     | T27.2–T27.5|
