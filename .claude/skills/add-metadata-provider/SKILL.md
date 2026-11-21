---
name: add-metadata-provider
description: Add a new metadata provider (a platform the app can read links from, search, and cross-reference, like Spotify, YouTube or SoundCloud) to goblin-malin, and make a download provider (yt-dlp, Soulseek) able to download its tracks. Use when the user asks to add, support or integrate a streaming platform / music site.
argument-hint: "<platform name, e.g. Deezer>"
---

Add the metadata provider `$ARGUMENTS` to goblin-malin.

The project's rule ([CLAUDE.md](../../../CLAUDE.md), "Provider extensibility"): **a provider is one service class (plus the files it needs next to it) and one `.register(...)` call in `initMusicApp()`.** If a step below seems to need an edit in core code (`downloadTask.ts`, a component, a column list), stop: the generic path is missing something. Fix the generic path (a static capability on the service, read through a registry) instead of branching on the provider's key. Read [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) first, then the closest existing provider and copy its shape: [YoutubeService](../../../src/flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService.ts) (no key, a library client), [SoundCloudService](../../../src/flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService.ts) (no key, reads the site through yt-dlp, gated search), [SpotifyService](../../../src/flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService.ts) (credentials, setup wizard, albums and playlists).

## 0. Decide before writing

Answer these from the platform, not from habit (a quick experiment with its API or `yt-dlp -J <url>` settles most; run it):

1. **How is a track read?** An official API (keys: a setup wizard, see Spotify), a keyless API, a page scrape, or yt-dlp's extractor for the site (`yt-dlp --list-extractors`). Prefer keyless, and one that already ships with a binary the app downloads.
2. **What is a track's id, and can the URL be rebuilt from it?** The id goes into `uri` (`PLATFORM::TRACK::<id>`), into the task's log prefix, and into `trackUrl(id)`. Use what appears in the link itself when it is stable and readable (SoundCloud: `<user>/<track>`); other discoverers (MusicBrainz, Songlink) produce links for the platform too, and ids that agree let results dedupe.
3. **Which URLs are tracks?** Make a list of everything else on the site (profiles, playlists, charts, short links, mobile hosts, `www`) and decide each: `null`, or a kind the service can really fetch. A `ParsedUrl` of type `album`/`playlist` without `expandCollection` is recognised and then cannot be fetched: return `null` for what you will not fetch.
4. **Can the platform download?** If a download provider can fetch it, put the platform key in that provider's `compatibleMetadataProviders` (yt-dlp already lists `youtube` and `soundcloud`; Soulseek lists every platform, since it searches by name). Which metadata is downloaded is decided by `DownloadTask.startDownloads`: the first non-rejected result of the best-ranked group whose `apiProvider` the provider accepts. Nothing else to write.
5. **Does it send data away or spend a quota?** Then it needs `static consent` and its `enabled` default must be `false` (see "Optional capabilities" in CLAUDE.md).

## 1. The platform keys

A platform key must exist in two unions in [types.ts](../../../src/flows/musicDownloadFlow/types.ts): `Platform` and `APIProvider`. Most well-known sites are already there (deezer, tidal, soundcloud, bandcamp, …); add the key only if it is missing, plus a `<Name>TrackMetadata` member of the `TrackMetadata` union (`platform`, `apiProvider`, `uri: TrackUri<"key">`). The registry key you register under **must equal the `platform` string** the service puts in its metadata and in `ParsedUrl.platform`: discovery finds the service for a discovered link by that key (`findServiceKeyForPlatform`). Another key for the same service (YouTube Music) is a `static platformAliases`.

Built-in colours for a platform already exist in [providerDisplay.ts](../../../src/base/providerDisplay.ts); the service's own `static display` wins and is the one to maintain.

## 2. The service class

Create `src/flows/musicDownloadFlow/services/metadata-providers/<key>/<Name>Service.ts`, `extends MetadataService` (constructor `super("<Name>Service", task, logger)`). Keep what is pure and testable in its own files next to it (`<key>Url.ts` for the URL parser, `convert<Name>ToTrack.ts` for mapping the platform's answer), and the Ink cell in `<Name>Cell.tsx`.

Required:

- `static readonly display: ProviderDisplay`: `label`, `acronym`, three colours. Never put display data in a component.
- `static readonly defaultSettings: ProviderSettingsSchema`: at least `enabled` (`kind: "checkbox"`). Settings → Metadata and the task-list column appear from this, with no other edit.
- `static readonly cellComponent`: the column cell (copy `SoundCloudCell.tsx`: it finds its group by `serviceKey`, shows the id). Keep it a `React.memo` function with no `useInput`.
- `static parseUrl(url): ParsedUrl | null`: pure, synchronous, must never throw on garbage (`new URL` in a try). `platform` = the registry key. Registered into `urlParserRegistry` automatically by `register()`.
- `getTrackMetadata(url): Promise<TrackMetadata>`: the platform's own, authoritative answer (`platform`, `apiProvider`, `uri`, `url`, `fetchedAt: new Date()`, `type: "track"`; no `fetchedBy`: that marks a rudimentary result from a discoverer). The `url` is the canonical page, never an API address or a link with tracking parameters. Throw a readable `Error` when it fails; the pipeline turns it into a row to retry.
- `searchTrack(seed): Promise<SearchTrackResult[]>`: finds the seed's track on this platform (discovery Phase A runs it for every task whose primary is on another platform). Use the seed's ISRC when the platform can look it up; otherwise search `artist + title`. Throw when the seed has no artist or title. **Gate weak matches**: score each hit with `computeConfidenceScore(hit, seed)` ([utils/confidence.ts](../../../src/flows/musicDownloadFlow/utils/confidence.ts)) and keep the ones at or above a bar (SoundCloud: 50), best first, a few at most: an open catalogue (anyone's upload) puts bootlegs next to the track, and an empty array is a valid answer.

Optional, all read generically (never branch on the key anywhere else):

- `static trackUrl = (id) => url`: needed whenever something has only the id (the log prefix, a discovered result).
- `static openUri = (parsed) => uri | undefined`: the platform's desktop-app address. Without it the link opens in the browser.
- `static upstreamCodec = "Opus"`: only when every stream of the platform is in one lossy codec (it names what a yt-dlp FLAC was transcoded from). A platform that serves several (SoundCloud) leaves it out.
- `static searchable = false`: only for a platform that cannot be searched at all (Tidal without a key); its `searchTrack` just returns `[]`. Phase A then skips it, and a track without a result for it does not start a last-resort (Claude) call.
- `static resolveLink = (url) => Promise<string> | null`: only for short links that say what they lead to (a track, an album) once followed (`link.deezer.com/s/…`). Return `null` at once for every other link; the import follows the others before it decides track or collection.
- `static platformAliases`, `static consent`, `static expandCollection` (albums and playlists: see `YoutubeService.expandCollection`), `static columnActions`, `static findLinks` (links written another way than a URL).
- `searchTracks(query, limit)`: a free-text search with no seed and no gating; **the chat agent's `search_music` finds the new platform through it, with no other change**. Do add it when `searchTrack` does a search anyway.
- `getAlbumDetails`: the whole album (barcode, track list), for the MusicBrainz checks. Only a platform that exposes the barcode needs it.

Conventions that bite:

- `@Cached()` stores the result in the disk cache (JSON, 90 days). Cache **plain data** (the platform's slimmed answer), not objects with `Date`s or class instances, and map to `TrackMetadata` afterwards. Cache the answer, not a failure.
- Do not keep a platform's whole answer: a yt-dlp track page is ~50 KB of JSON with every stream address. Pick the fields you read (`slimSoundCloudInfo`).
- `this.status.set({ type: StatusType.Processing, … })` before a slow call and `status.clear()` after; on failure `StatusType.Error`. A hung external process must not hold the metadata stage: wrap it in `withTimeout` (`#utils/withTimeout`).
- Heavy imports (an API client library) are loaded on first use with `await import(...)`, since the app starts every provider's module at launch.
- No synchronous file-system calls in the pipeline; no spinner or timer of your own; prefer the `#...` import aliases from `package.json` over relative paths.
- Everything the user typed or pasted lives outside what the pipeline rebuilds (`userSources`): you get that for free by only returning data, never by writing to the task's attributes.
- Sharing a binary or client with another provider: put the shared code in `services/apis/` (as `ytdlp-client.ts` is shared by `YtDlpService` and `SoundCloudService`), never import one provider's class from another.

Reading a site through yt-dlp (`getYtDlpClient()` from `services/apis/ytdlp-client.ts`): `getInfoAsync<"video">(url)` for one page, `getInfoAsync<"playlist">("<prefix>search<N>:<query>")` for a search (check the prefix with `yt-dlp -J --flat-playlist "<prefix>search2:test"`: a flat listing of some extractors already has title, uploader, duration and page, so no request per result). In yt-dlp's JSON the `url` of an entry is often an API address: use `webpage_url`. Beware that `_type: "playlist"` can come back for a short link that led to a set.

## 3. Register it

In [init.ts](../../../src/flows/musicDownloadFlow/init.ts): import the class and add `metadataServiceRegistry.register("<key>", <Name>Service);`. **Registration order is group order** in the task list and in discovery (the primary's group comes first, then the registry order), and the download stage tries groups in that order: register a keyless, reliable platform before a noisy one.

If a download provider should download it, add the key to its `compatibleMetadataProviders` (a one-line, in the download service's own file). Check the provider's own assumptions about the source while there: `YtDlpService` labels a FLAC it made as "transcoded from Opus" only for a platform that always serves Opus (`UPSTREAM_CODEC`); a new platform must not inherit a claim that is not true of it.

## 4. Tests

Write `tests/unit/<key>.test.ts` (copy [soundcloud.test.ts](../../../tests/unit/soundcloud.test.ts)); `yarn vitest run tests/unit/<key>.test.ts` is quick:

- **`parseUrl` matrix**: the track in every host variant (`www`, `m.`, short link, trailing slash, query), the private/secret form if any, and every non-track page returning `null`, plus other sites and non-links.
- **The mapper against real data**: run the platform once for real and paste a trimmed answer into the test as a fixture (never an invented one): title, artists, duration in ms, canonical url, uri, and the artist split / missing-field cases.
- **The service with its client faked** (`vi.mock` of the client module; build the service with a fake task `{ getStatus: () => status }` and logger with `createChild`; `setCacheEnabled(false)`, so nothing reads or writes the app's cache): `getTrackMetadata` asks for the canonical page, refuses a non-track, `searchTrack` keeps the good hits best first and returns `[]` for none, `searchTracks` returns every readable hit up to the limit.
- **The download side**: the download provider's `canDownload(<your metadata>)` is true, and false for a platform it cannot read.

Then the real thing. Unit tests with fakes do not prove the platform answers like the fixture says:

1. Run a scenario with the TUI harness ([scripts/tui-test/README.md](../../../scripts/tui-test/README.md)): `type` a link of the platform (it behaves like a paste: the import dialog opens, titled `[<Label>]`), `Enter` to import, `Enter` again on the toolbar's Run, wait, then snapshot. Put the scenario's fixture (settings.json, sessions.json, and a `bin/` holding the downloaded `yt-dlp` and `ffmpeg` so nothing is fetched) in your scratch directory, not in the repo (`scripts/tui-test/fixtures/*/bin/` is ignored on purpose). A blank fixture raises the Spotify setup wizard and the Songlink consent during discovery: `ArrowDown` + `Enter` (scraped mode), `Esc`, and `ArrowRight` + `Enter` (don't allow) answer them. `stable` never settles while a spinner runs: use `wait`.
2. Check the screen shows the platform's column filled, the compiled metadata (title, artist, duration), and, if a download provider can fetch it, a download source `used <PLATFORM>::TRACK::<id>` and a file in the isolated output folder.
3. Call `searchTrack` once for real (a small `tsx` script with a fake task, `GOBLIN_DATA_DIR` pointing at a folder that has the binaries) with a track that exists, one with several uploads, and a nonsense one.

## 5. Documentation

- [CHANGELOG.md](../../../CHANGELOG.md), under `## [Unreleased]` → `### Added`: one entry in plain words for a user (what they can paste, what is read, what is downloaded, what is not supported yet).
- [CLAUDE.md](../../../CLAUDE.md) "Active vs. disabled code" and the registered-services table in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).
- [README.md](../../../README.md): the "What it does" lines, and the Privacy table when the platform is contacted (say when, and what is sent).
- [TODO.md](../../../TODO.md): tick or reword what is now done; list what is not (playlists, albums).
- Run `yarn run agent:tools --write` if a tool's catalogue could have changed (a new searchable platform changes nothing in the file today, but a unit test fails if it is out of date).

## 6. Check before saying it is done

`yarn run type-check && yarn run lint && yarn run format:check && yarn test` (from a bash with an uppercase drive letter: `cd "C:/Users/..."`, or every vitest file fails). Do not commit or push unless the user asks.

Tell the user what was verified for real (a live import, a live download, a live search) and what was not, and what the new provider does **not** do (collections, albums, ISRC, anything the platform does not offer).
