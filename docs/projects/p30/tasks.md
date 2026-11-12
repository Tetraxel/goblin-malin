# P30 — MusicBrainz Identity: Know Your Release, Add It If It's Missing

This page is the map of what was built and where it lives. The safety rule over all of it: a release is picked without the user only on a direct identifier (barcode + track count, or the streaming link already on the release); anything weaker is a review the user decides.

**Supersedes** [P27/T27.4](../p27/tasks.md) (release-ID completion by a "best release" heuristic) and [P29/T29.3](../p29/tasks.md) (find or create a MusicBrainz release). It fixes `MD-03`: MusicBrainz IDs now reach the saved file.

## What the user gets

| Feature                                                                                                                                                                                                                                                                                                                                                                              | Where                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** A MusicBrainz verdict per track (matched / needs review / not in MusicBrainz / unknown), with the evidence                                                                                                                                                                                                                                                                    | MB column glyph (`✔ ? ✚ …`); the "MBRAINZ" block of the compiled metadata                                                                      |
| **F2** Automatic matching on conclusive evidence only (barcode + track count, or the streaming link already on a release)                                                                                                                                                                                                                                                            | `musicbrainz/resolveIdentity.ts`                                                                                                               |
| **F3** Review candidates; pick the right artist among same-name artists                                                                                                                                                                                                                                                                                                              | MB column actions `Review MusicBrainz match` / `Choose MusicBrainz artist`; `ListDialogModal`                                                  |
| **F4** Add a missing release: preview, then the browser opens (Harmony, or the app's own seed form)                                                                                                                                                                                                                                                                                  | MB column action `Add to MusicBrainz`                                                                                                          |
| **F5** Album-aware: a decision about one track holds for the album's other tracks                                                                                                                                                                                                                                                                                                    | `identityActions.albumSiblings`                                                                                                                |
| **F6** The IDs in the saved file (`MUSICBRAINZ_TRACKID/ALBUMID/ARTISTID/RELEASEGROUPID`)                                                                                                                                                                                                                                                                                             | Settings → MusicBrainz → "Write MusicBrainz IDs into saved files" (on by default)                                                              |
| **F8** A streaming service sells the digital edition: when the identifiers point at another edition (the CD that carries the reused barcode), the one official Digital Media release of the same release group with the same track count is matched instead. The other releases that could be the one are listed under a matched release, and the release group opens in the browser | MB column actions `Other MusicBrainz releases` / `Open MusicBrainz release group`; `resolveIdentity.ts` (`preferDigital`, `buildAlternatives`) |
| **F7** Re-check, on one track or a selection                                                                                                                                                                                                                                                                                                                                         | MB column action `Re-check on MusicBrainz`                                                                                                     |

## Code map

`src/flows/musicDownloadFlow/musicbrainz/`

- `resolveIdentity.ts`, `thresholds.ts`, `normalize.ts` — the **pure** gate: evidence in, verdict out. No network, no clock. The tiers are in the header of `resolveIdentity.ts`.
- `identityCheck.ts` — runs the four checks (barcode, streaming link, ISRC, title + artist) through `MusicBrainzClient`, shares answers between the tracks of an album, never throws (a failed lookup is recorded and keeps the verdict from being "not found").
- `mapMusicBrainz.ts` — `musicbrainz-api` entities → the trimmed shapes the resolver uses.
- `buildReleaseSeed.ts` — the fields that pre-fill MusicBrainz' "Add release" editor, per the [seeding spec](https://wiki.musicbrainz.org/Development/Seeding/Release_Editor). `harmonyLink.ts` — the Harmony import link. `seedServer.ts` — the one-shot loopback server that serves the seed form and catches `release_mbid`.
- `identityActions.ts` — review, artist pick, consent, the last album-wide duplicate look, the hand-off. `columnActions.ts` — what the MusicBrainz column offers.

Elsewhere: `DownloadTask.checkMusicBrainz()` / `fetchAlbumDetails()` and discovery's phase D (`utils/downloadTask.ts`); `MetadataService.getAlbumDetails?` (Spotify implements it: the album's UPC, the full track list, optionally every ISRC); `static columnActions` on a service class (`service-registry.ts`, read by `contextualActions.ts`); `dialogBridge` + `ListDialogModal` (ask the user something from plain TS); the `musicBrainz` settings group (`settings.ts`, `buildFlowSettingsItems.ts`).

## Done

- T30.1–T30.2 — settings group; IDs from the verdict feed `compiledMetadata.musicBrainzIds` and the tags.
- T30.3–T30.7 — album barcode via `getAlbumDetails`; client lookups; resolver + tests; per-album evidence sharing; status UI.
- T30.8–T30.10 — review dialogs, album-wide decisions, re-check (single and batch).
- T30.11–T30.13 — consent (off until allowed once), preview, Harmony deep link.
- T30.14–T30.16 — seed builder, loopback seed server, `release_mbid` verified against the same evidence rules.
- Tags, completed against a Picard-tagged file: the file now also gets `MUSICBRAINZ_ALBUMARTISTID` (the matched release's own artist credit) and `MUSICBRAINZ_RELEASETRACKID` (the release's track for the recording, from one extra `lookup release inc=recordings` once a release is matched: `MusicBrainzIdentity.releaseTrackId`). Naming trap: `MUSICBRAINZ_TRACKID` is the **recording**; the UI labels follow MusicBrainz' entity names (`utils/musicBrainzTagFields.ts`).
- Per-track switch **Include MusicBrainz tags** in the file panel (`TrackDownloadTask.includeMusicBrainzTags`, unset = Settings → MusicBrainz → include tags). It shows the ids saving would write; for a saved file the panel reads the file itself (not the download's `fileInfo`) and says `IN FILE` / `DIFFERS` / `NOT IN FILE`, with a "MusicBrainz in file" section. With the switch off the ids are not even looked up on save.

Tests: `tests/unit/musicBrainz{Resolver,IdentityCheck,Client,Seed,TaskStage,Flows,TagsInFile}.test.ts` (shared fake world in `tests/unit/helpers/musicBrainzWorld.ts`).

## Found while building it (checked against the live API)

- A URL's release relations carry only a **stub** of each release: the client fetches the release in full (artists, track count, release group).
- The **ISRC endpoint ignores `inc=releases`**: recordings come back without releases. The client looks each recording up by id (at most 25 releases per lookup: the ISRC evidence is partial for a track on very many releases, which is why it is never the only evidence).

## Not done / not verified

- The first real "Enter edit" round trip (Harmony and the direct seed) has not been run against MusicBrainz: it creates a real public edit, so it needs a deliberate, supervised try — ideally on `test.musicbrainz.org`.
- Harmony's query parameters beyond `url` and `gtin`; whether a new release is applied immediately (the re-check tolerates a delay: press `Re-check`).
- The `link_type` of the streaming link is not sent (MusicBrainz guesses it from the URL).
- Out of scope: cover art, ISRC submission, creating artists/labels directly, a bot account.
