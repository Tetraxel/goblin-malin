# P26 — Search-Based & Text Import: Tasks

## Context

**Import currently requires a URL — but users start from a song name at least as often as from a link.** `detectUrls()` ([detectUrls.ts](../../../src/components/ImportModal/detectUrls.ts)) extracts `https?://` matches and discards everything else. That excludes three big real-world inputs:

1. "I know the song": *Petit Biscuit — Sunset Lover* — no URL at hand.
2. **Text tracklists**: pasted from a DJ set description, a forum post, a label's release notes (`01. Artist - Title`).
3. **Playlist exports**: M3U/M3U8 files, rekordbox/Serato CSV exports — the bridge from existing DJ libraries into this app.

The search capability largely exists: every `MetadataService` implements `searchTrack(sourceTrackMetadata)` ([metadataService.ts](../../../src/flows/musicDownloadFlow/metadataService.ts):25) for discovery — what's missing is a text entry point and an import-modal picker. This project turns the import modal into "paste *anything*".

---

## Tasks

### T26.1 — `searchByText()` on `MetadataService`

```typescript
// Default implementation on the base class: build a minimal seed
// TrackMetadata { trackName, artists } from the parsed query and
// delegate to searchTrack(). Services override for native text search.
searchByText(query: { artist?: string; title: string }): Promise<SearchTrackResult[]>;
```

- Spotify override: SDK `search()` with `track:"…" artist:"…"` qualifiers (works in both P14 auth modes that support search; scrape mode falls back to the base implementation).
- YoutubeService override: `ytmusic-api` song search (it's a text API already).
- Results reuse `SearchTrackResult` (metadata + match confidence) so downstream ranking is shared with discovery.

_Depends on: nothing_

---

### T26.2 — Text-line parser

`src/components/ImportModal/parseTextLines.ts` — classify each non-URL line of pasted text:

- **Tracklist formats**: `NN. Artist - Title`, `Artist – Title (Extended Mix)`, `[hh:mm] Artist - Title` (timestamps stripped), separators `-`, `–`, `—`, `by`.
- **M3U/M3U8**: `#EXTINF:duration,Artist - Title` lines (duration kept as a match hint).
- **CSV**: header sniff for artist/title/name columns (rekordbox and Serato exports both qualify); quoted-field aware.
- Output `ParsedQuery { artist?, title, durationMs?, raw }` per line; lines that classify as noise (empty, pure timestamps, URLs already handled) are dropped; ambiguous lines are kept with `artist: undefined` (searched as full-text title).

Pure functions, fixture-heavy tests (T26.6).

_Depends on: nothing_

---

### T26.3 — Import modal: search rows & result picker

Extend [ImportModal](../../../src/components/ImportModal/ImportModal.tsx) / [useImportFlow.ts](../../../src/components/ImportModal/useImportFlow.ts):

- Pasted content is split into URL rows (existing path, incl. P21 collections) and **search rows** (`? Petit Biscuit — Sunset Lover`).
- `[Enter]` on a search row opens an inline picker: top N results across *enabled* metadata providers, each row showing provider acronym (colored via `providerDisplayRegistry`), title, artist, duration, and a `Δ duration` marker when the parsed line had one. `↑/↓` select, `[Enter]` confirm → the row becomes a normal import row carrying the result's URL/URI (task creation is unchanged — it goes through `createTasksFromUrls`).
- Searches run through the metadata stage limiter; per-row spinner on the shared cadence.

_Depends on: T26.1, T26.2_

---

### T26.4 — Batch auto-match mode

For big pastes (a 30-line tracklist), picking one by one is tedious:

- Footer toggle **"Auto-match best result"**: for each search row take the top-confidence result when it clears a threshold (title similarity + artist similarity + duration within ±5 s when known — reuse/extract the scoring already used to rank `SearchTrackResult` in discovery so there is one similarity implementation).
- Rows below the threshold stay as manual-pick rows, visually flagged — confident lines flow through, doubtful ones get human eyes. The confirm summary line shows `24 matched · 3 need review · 2 no results`.

_Depends on: T26.3_

---

### T26.5 — "Add track by search" action

The same picker, reachable without a clipboard: a toolbar/action-bar entry opening the import modal in search mode with an empty text input (`ink-text-input`, keys owned by it — legacy `shortcut` prop with comment, per the shortcuts philosophy). Covers the "one quick track" flow end-to-end with zero context switching to a browser.

_Depends on: T26.3_

---

### T26.6 — Tests

- Unit: parser fixtures (plain tracklists with all separator variants, M3U with EXTINF, rekordbox + Serato CSV samples, noisy pastes); auto-match threshold matrix with synthetic results.
- TUI harness: paste-tracklist scenario with a fixture search service → picker → confirm → tasks created; auto-match scenario asserting the review split.

_Depends on: T26.1–T26.4_

---

## Summary

| Task  | What                                                     | Depends on   |
| ----- | --------------------------------------------------------- | ------------ |
| T26.1 | `searchByText()` base impl + Spotify/YouTube overrides    | —            |
| T26.2 | Tracklist / M3U / CSV line parser                         | —            |
| T26.3 | Search rows + inline result picker in the import modal    | T26.1, T26.2 |
| T26.4 | Confidence-gated batch auto-match                         | T26.3        |
| T26.5 | "Add track by search" manual entry point                  | T26.3        |
| T26.6 | Parser fixtures + TUI-harness scenarios                   | T26.1–T26.4  |
