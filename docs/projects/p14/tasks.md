# P14 — Spotify auth-mode choice & spotify-url-info fallback

## Goal

Today `SpotifyService` only works through the **official Spotify Web API**, which requires a Premium account and a developer app (`SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`). Users without credentials — or whose API call fails — get no Spotify metadata (the flow only falls back to discovery services like Songlink, which give cross-platform links, not Spotify track metadata).

The [`spotify-url-info`](https://www.npmjs.com/package/spotify-url-info) package (v3.3.0, validated by [scripts/spotify-url-info-test.mjs](../../../scripts/spotify-url-info-test.mjs)) scrapes Spotify's **public embed page** — no account, no auth — returning title, artist(s), duration (ms), preview URL, cover image, release date. It cannot search and gives no album/ISRC.

This project:

1. **Lets the user choose**, in the existing Setup Wizard (P10), between the official API (2 vars) and `spotify-url-info` (no auth). The choice is persisted to `SPOTIFY_AUTH_MODE` in `.env`.
2. **Falls back automatically**: in official mode, if the API call fails, fetch via `spotify-url-info`.
3. **Tags the source** in the displayed `Uri` as `(Spotify Web)` — like Songlink's `(Songlink)` tag — even though `spotify-url-info` is **not** a `DiscoveryMetadataService`. It sets `fetchedBy` on a same-platform Spotify result.

### Design decisions

- Source label shown in the `Uri` and group header: **"Spotify Web"** (provider key `spotifyUrlInfo`).
- The existing group-header note (`fetchedBy !== apiProvider`) is **kept as-is** — for a `spotify-url-info` result it reads _"Spotify is not available but rudimentary metadata were fetched from Spotify Web"_.
- The wizard mode chooser is added to the **generic** wizard config (data-driven, reusable by any future provider — consistent with the provider-extensibility philosophy).
- **No change to `downloadTask.ts`**: its existing primary-fetch `try/catch` + discovery fallback stays as an outer safety net (only triggers if *both* official and scrape fail, because the fallback now lives inside `getTrackMetadata`).

---

## Wizard config — added "modes" (`src/base/setupWizard.ts`)

```typescript
export interface WizardMode {
  id: string; // "official" | "scrape"
  label: string; // shown in the chooser
  description?: string; // one helper line under the chooser
  fields: WizardField[]; // mode-specific fields (scrape → [])
}

export interface SetupWizardConfig {
  title: string;
  providerKey?: string;
  providerType?: "metadata" | "download";
  description: WizardContentBlock[];
  fields: WizardField[]; // used only when `modes` is absent (back-compat)
  modeEnvVar?: string; // e.g. "SPOTIFY_AUTH_MODE" — where the chosen mode id is persisted
  modes?: WizardMode[]; // if present → wizard shows a mode chooser
  envSection?: { name: string; url?: string };
}
```

## Modal layout (with mode chooser)

```
╭── ⚙  Spotify Setup Wizard ───────────────────────────────╮
│  Choose how to fetch Spotify metadata:                   │
│   ◉ Official Spotify API (needs Premium + app creds)     │
│   ○ spotify-url-info (no account, reads public page)     │
│                                                          │
│  [official]  Best metadata (album, ISRC, track number).  │
│                                                          │
│  CLIENT_ID      [b94c59cdcd…                  ]          │
│  CLIENT_SECRET  [                             ]  ← focus │
│                                                          │
│  ↑↓ Navigate  Enter Open/Edit  ^S Submit  Esc Cancel  D Disable │
╰──────────────────────────────────────────────────────────╯
```

When `config.modes` is present, a radio-style chooser is rendered above the fields. Selecting a mode (Enter) swaps the visible fields (scrape mode shows none). `Ctrl+S` persists `SPOTIFY_AUTH_MODE` + the active mode's fields.

---

## Tasks

### T14.1 — Promote spotify-url-info to a runtime dependency

**File:** `package.json`

Move `spotify-url-info` from `devDependencies` to `dependencies` (now imported by production code). The package ships its own types at `spotify-url-info/src/index.d.ts`; default export is a CJS factory `(fetch) => SpotifyUrlInfo` — confirm it imports cleanly under the project's `esModuleInterop`.

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.2 — Extend SetupWizardConfig with modes

**File:** `src/base/setupWizard.ts`

Add the `WizardMode` interface and the optional `modeEnvVar` / `modes` fields to `SetupWizardConfig` as shown above. Types only. `fields` stays for providers that don't use modes.

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.3 — Make getVariablesWithWizard mode-aware

**File:** `src/base/env.ts`

When `config.modes` is present:

- `chosenMode = process.env[config.modeEnvVar!] ?? config.modes[0].id` (defaulting to the first mode — `official` — keeps existing users with creds but no `SPOTIFY_AUTH_MODE` working without a re-prompt).
- Resolve the active mode; if all its `fields` are already in `process.env`, return `{ [modeEnvVar]: chosenMode, ...modeFieldValues }` with **no** wizard.
- Otherwise show the wizard; persist the returned mode (under `modeEnvVar`) + that mode's field values (reuse existing `saveEnvVarsGroup` / `saveEnvVar` + `process.env` writes), then return them.

The non-modes path is unchanged.

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.4 — Render the mode chooser in the wizard modal

**File:** `src/components/SetupWizardModal/SetupWizardModal.tsx`

- Add an interactive item `kind: "mode"`; when `config.modes` exists, prepend a navigable radio chooser above the fields.
- Track `selectedMode` in state, initialized from `process.env[config.modeEnvVar] ?? config.modes[0].id`.
- Everything currently iterating `config.fields` (`buildInteractiveItems`, `fieldValues` init, `labelWidth`, the fields render block, `handleSubmit`) must use the **active mode's fields** when modes are present.
- `handleSubmit`: persist `config.modeEnvVar = selectedMode` + the active mode's field values, then resolve the pending prompt with that object (scrape mode submits with zero credential fields).

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.5 — spotify-url-info API client

**File:** `src/flows/musicDownloadFlow/services/apis/spotify-url-info-client.ts` (new)

Mirror the location/shape of [songlink-client.ts](../../../src/flows/musicDownloadFlow/services/apis/songlink-client.ts).

```typescript
import createSpotifyUrlInfo, { type Details } from "spotify-url-info";

const api = createSpotifyUrlInfo(fetch); // Node 18+ global fetch — no auth

export function getSpotifyEmbedDetails(url: string): Promise<Details> {
  return api.getDetails(url); // one call → { preview, tracks }
}
```

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.6 — convertSpotifyUrlInfoToTrack

**File:** `src/flows/musicDownloadFlow/services/metadata-providers/spotify/convertSpotifyUrlInfoToTrack.ts` (new)

Mirror [convertSonglinkToTrack.ts](../../../src/flows/musicDownloadFlow/services/metadata-providers/songlink/convertSonglinkToTrack.ts) (including its `parseArtistNames` split). Map `Details` → `TrackMetadata`:

| Field                  | Source                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `id`                   | parsed `trackId`                                                      |
| `trackName`            | `tracks[0].name`                                                      |
| `artists`              | `parseArtistNames(tracks[0].artist)` → `{ type: "artist", name }[]`   |
| `duration`            | `tracks[0].duration` (already **ms** — verified: a 3:40 track → 220166) |
| `url`                  | original url                                                          |
| `uri`                  | `` `SPOTIFY::TRACK::${id}` ``                                         |
| `nativeAppUriDesktop`  | `` `spotify:track:${id}` ``                                          |
| `platform`            | `"spotify"`                                                           |
| `apiProvider`         | `"spotify"`                                                           |
| `fetchedBy`           | `"spotifyUrlInfo"`                                                    |
| `fetchedAt` / `type`  | `new Date()` / `"track"`                                              |

Album / ISRC / track number are not available from the embed page → omitted (all optional on `BaseTrackMetadata`).

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.7 — SpotifyService: mode resolution + scrape fallback

**File:** `src/flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService.ts`

- Replace the `setupWizard` static with the **modes** form: `modeEnvVar: "SPOTIFY_AUTH_MODE"`, keeping `envSection`; mode `official` carries the current `CLIENT_ID` / `CLIENT_SECRET` fields + description, mode `scrape` has `fields: []` and helper text noting limited metadata + possible breakage.
- Add `private async resolveAuth()` using `runExclusive("init", …)` → calls `this.env.getVariablesWithWizard(SpotifyService.setupWizard)`, reads `process.env.SPOTIFY_AUTH_MODE` (default `"official"`). `getClient()` builds the official client from the returned creds (official mode only).
- `getTrackMetadata(url)`:
  - parse `trackId` (existing);
  - `mode === "scrape"` → `return this.fetchViaUrlInfo(url, trackId)`;
  - `mode === "official"` → `try` the existing official path; `catch` → `logger.warn(...)` + `return this.fetchViaUrlInfo(url, trackId)`.
- Add `private async fetchViaUrlInfo(url, trackId)` using T14.5 client + T14.6 converter.
- `searchTrack`: in scrape mode `spotify-url-info` cannot search — throw a clear error (already caught by the discovery flow; acceptable degradation). Official mode unchanged.

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.8 — Register the new provider key & display

**Files:** `src/flows/musicDownloadFlow/types.ts`, `src/base/providerDisplay.ts`

- Add `"spotifyUrlInfo"` to the `APIProvider` union (so `fetchedBy` accepts it).
- Add to `BUILTIN_PROVIDERS`:

```typescript
spotifyUrlInfo: { label: "Spotify Web", acronym: "SPOTIFY WEB", color: "#3bb0a0", colorSubtle: "#0f5a52", colorBright: "#56d4c4" },
```

This makes `providerDisplayRegistry.get("spotifyUrlInfo")` resolve so [Uri.tsx](../../../src/components/SecondaryPanel/MetadataPanel/Uri.tsx) renders `(Spotify Web)` automatically — **no component change**. `MetadataGroupHeader.tsx` is also unchanged (note kept per decision).

| Status  |
| ------- |
| ⬜ Todo |

---

### T14.9 — Update docs/projects/README.md

**File:** `docs/projects/README.md`

Add the `P14` row pointing at `p14/tasks.md`.

| Status  |
| ------- |
| ⬜ Todo |

---

## Verification

| Check                          | Action                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Types & lint                   | `yarn type-check` and `yarn lint` clean                                                                               |
| Wizard shows mode chooser      | `yarn dev` → paste a Spotify track URL with no creds → wizard shows the official/spotify-url-info chooser             |
| Scrape mode works              | Pick **spotify-url-info** → primary metadata appears, URI tagged **(Spotify Web)**                                    |
| Choice is persisted            | `.env` gains `SPOTIFY_AUTH_MODE=scrape` under `# SPOTIFY`; re-running / new URL does not re-prompt                    |
| Official fallback works        | Switch to **official** with deliberately bad creds → API fails → auto-falls back to **(Spotify Web)** (no prompt)    |
| Official happy path unaffected | Official with valid creds → normal Spotify metadata, **no** `(Spotify Web)` tag                                       |
| Package sanity                 | `node scripts/spotify-url-info-test.mjs <url>` still returns preview/tracks                                           |
```

