# P15 — URI parsing on import

## Goal

A track's `uri` (e.g. `SPOTIFY::TRACK::123`) used to be produced only **after** the
primary source was fetched, inside `startPrimaryMetadataFetching()`. That method
also re-discovered *which* service recognized the URL by looping over every
registered metadata service and calling its static `parseUrl` ("if/if/if").
Unrecognized URLs were silently dropped at the `detectUrls` stage and never became
tasks.

This project moves recognition to **import time**: every imported URL is matched
against the registered `MetadataService.parseUrl` functions **once**, and the
resulting `uri` is stored on the task **from creation** — before any fetch.

- The UI shows immediately whether a URL was recognized by a service.
- The per-service detection loop in `startPrimaryMetadataFetching` is removed.
- Unrecognized URLs still become tasks (shown as `Unknown`); a URL not recognized
  at import is never recognized later.
- Every task carries its `uri` from the start (groundwork for future logging —
  logging itself is **out of scope**).

### Design decisions

- **`uri` is stored as an object** (`TrackUriParts`) for handy field access, with
  helpers to convert to/from the canonical `PLATFORM::TRACK::ID` string when needed.
- **Unknown URL** in the task list renders just `Unknown` (no raw URL).
- **Builtin non-service URL parsers** (Deezer/Apple Music/Tidal/SoundCloud, which
  have no registered service and yield no `id`/`uri`) are **removed entirely** —
  recognition is purely `MetadataService`-based everywhere, including the modal.
- `recognizedServiceKey` is stored as a sibling of `uri` because it is routing info,
  not part of the URI identity, and because **serviceKey ≠ platform** (the `youtube`
  service recognizes `music.youtube.com` URLs whose platform is `youtubeMusic`).

---

## Data model

```ts
// src/flows/musicDownloadFlow/types.ts
export type TrackUriParts = {
    platform: Platform; // exact casing, e.g. "spotify", "youtubeMusic"
    type: "track";
    id: string;
};

// TrackDownloadTask (set together, or both absent ⇒ "Unknown")
uri?: TrackUriParts;
recognizedServiceKey?: string;
```

Both fields are plain values, so `reviveTaskDates` (which spreads `...attrs`)
round-trips them through session snapshots with no change.

---

## Tasks

### T15.1 — Add `TrackUriParts` + task fields

**File:** `src/flows/musicDownloadFlow/types.ts`

Add the `TrackUriParts` type and the optional `uri` / `recognizedServiceKey` fields
to `TrackDownloadTask`. The existing string `TrackUri` type is unchanged and still
powers `TrackMetadata.uri`.

| Status  |
| ------- |
| ✅ Done |

---

### T15.2 — URI conversion helpers

**File:** `src/flows/musicDownloadFlow/utils/trackUri.ts` (new)

`formatTrackUri(parts) → "PLATFORM::TRACK::ID"` and `parseTrackUri(str) → parts`.
Note the string form uppercases the platform, so `parseTrackUri` is best-effort and
loses camelCase (e.g. `youtubeMusic`); prefer the stored object when exact casing
matters.

| Status  |
| ------- |
| ✅ Done |

---

### T15.3 — Recognition resolver

**File:** `src/flows/musicDownloadFlow/utils/resolveTrackRecognition.ts` (new)

`resolveTrackRecognition(url, registry)` iterates `registry.getAllConstructors()`,
calls each `parseUrl`, and returns `{ serviceKey, uri: TrackUriParts }` for the first
match with `type === "track"` and an `id`, else `null`. Single source of truth for
"URL → recognition", used by both task creation and primary-metadata fetching. Uses
`import type { DownloadTask }` to avoid a runtime import cycle.

| Status  |
| ------- |
| ✅ Done |

---

### T15.4 — Resolve recognition at task creation

**File:** `src/flows/musicDownloadFlow/musicDownloadFlow.ts`

In `createTasksFromUrls`, call `resolveTrackRecognition(url, this.metadataServiceRegistry)`
per URL and set `uri` + `recognizedServiceKey` on the task attributes.

| Status  |
| ------- |
| ✅ Done |

---

### T15.5 — Read recognition in `startPrimaryMetadataFetching`

**File:** `src/flows/musicDownloadFlow/utils/downloadTask.ts`

Delete the `getAllConstructors()` detection loop. Read `recognizedServiceKey` and
`uri.platform` from the task attributes. When absent (Unknown task reached only when
`toTag` is set), keep the existing failure path (`StatusType.Error`, "Primary
metadata unavailable", throw). Steps 2 & 3 (fetch + discovery fallback) are unchanged.

| Status  |
| ------- |
| ✅ Done |

---

### T15.6 — Remove builtin URL parsers

**File:** `src/base/urlParser.ts`

Remove the `BUILTIN_URL_PARSERS` array (and the now-unused `tryParseUrl`); start the
registry's `parsers` empty. Only registered `MetadataService.parseUrl` functions
remain. `ParsedUrl` / `UrlParser` types and the registry are kept.

| Status  |
| ------- |
| ✅ Done |

---

### T15.7 — Keep unrecognized URLs in the import modal

**File:** `src/components/ImportModal/detectUrls.ts`

Stop dropping URLs that don't parse — push `{ platform: "unknown", type: "unknown",
raw }`. They render as `[UNKNOWN]` in the modal (via the providerDisplay fallback)
and still become tasks. No change needed to `ImportModal.tsx` / `useImportFlow.ts`.

| Status  |
| ------- |
| ✅ Done |

---

### T15.8 — Show the import-time URI in the URL column

**File:** `src/flows/musicDownloadFlow/columns/UrlCell.tsx`

Render priority: (a) fetched primary-metadata `uri` (existing `<Uri>`); else
(b) import-time `task.attributes.uri` via `<Uri uri={formatTrackUri(uri)}
platform={uri.platform} … />`; else (c) plain `Unknown` text. `Uri.tsx` is unchanged.

| Status  |
| ------- |
| ✅ Done |

---

### T15.9 — Docs

**Files:** `docs/projects/README.md`, `docs/projects/p15/tasks.md`

Add the `P15` row and this task breakdown.

| Status  |
| ------- |
| ✅ Done |

---

## Verification

| Check                     | Action                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Types & lint              | `yarn type-check` and `yarn lint` clean                                                                       |
| URI shown before fetch    | `yarn dev` → paste a Spotify track URL → URL column shows `SPOTIFY::TRACK::…` immediately, badge `[SPOTIFY]`  |
| YouTube Music platform    | Paste `music.youtube.com/watch?v=…` → shows `YOUTUBEMUSIC::TRACK::…`                                          |
| Unknown URLs become tasks | Paste a Deezer/Apple/Tidal/SoundCloud or random URL → modal `[UNKNOWN]`, task created, URL column `Unknown`   |
| Recognized fetch works    | Run a recognized task with "Fetch Metadata" → primary fetch works (driven by stored `recognizedServiceKey`)   |
| Unknown fetch fails clean  | Run an Unknown task with "Fetch Metadata" → fails "Primary metadata unavailable" (unchanged behavior)         |
| Snapshot round-trip       | Save a session and reload → `uri` / `recognizedServiceKey` survive                                           |
