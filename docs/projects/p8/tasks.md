# P8 — Provider Extensibility Registry

## Goal

Eliminate hardcoded provider color/label dictionaries, cell component maps, and URL classification logic so that adding a new provider only requires a service class + one `.register()` call.

## Tasks

### Phase 1 — Display registry

| ID    | Task                                                                                                                                                                                   | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T8.1  | Create `src/base/providerDisplay.ts` — `ProviderDisplay` interface, `ProviderDisplayRegistry` class, `providerDisplayRegistry` singleton, `BUILTIN_PROVIDERS` with all known platforms | ✅ Done |
| T8.2  | Extend `ServiceRegistry.register()` to accept a class constructor — reads `static display` off the class and auto-registers it in `providerDisplayRegistry`                            | ✅ Done |
| T8.3  | Add `static readonly display: ProviderDisplay` to `SpotifyService`, `YoutubeService`, `YtDlpService`, `SoulseekService`                                                                | ✅ Done |
| T8.4  | Update `MusicDownloadFlow` — remove `SERVICE_DISPLAY_MAPPING`, switch to class-based `.register(ServiceClass)`, replace `getColumns()` lookups with `providerDisplayRegistry.get(key)` | ✅ Done |
| T8.5  | Update `MetadataHeader.tsx` — remove `PLATFORM_DISPLAY`, use `providerDisplayRegistry.get().label/.color`                                                                              | ✅ Done |
| T8.6  | Update `DownloadSourceDetail.tsx` — remove `PLATFORM_DISPLAY` + `DOWNLOAD_PROVIDER_DISPLAY`, use registry                                                                              | ✅ Done |
| T8.7  | Update `MetadataSourceRow.tsx` — remove `PLATFORM_DISPLAY` + `SERVICE_DISPLAY_MAPPING` import                                                                                          | ✅ Done |
| T8.8  | Update `SourcesHintBar.tsx` — remove `PLATFORM_DISPLAY` + `SERVICE_DISPLAY_MAPPING` import                                                                                             | ✅ Done |
| T8.9  | Update `ImportModal.tsx` — remove `PLATFORM_DISPLAY` + `SERVICE_DISPLAY_MAPPING` import                                                                                                | ✅ Done |
| T8.10 | Update `FieldRow.tsx` — remove `PLATFORM_SUBTLE_COLORS`, use `providerDisplayRegistry.get().colorSubtle`                                                                               | ✅ Done |
| T8.11 | Update `MetadataDetailPanel.tsx` — remove `PLATFORM_BRIGHT_COLORS`, use `providerDisplayRegistry.get().colorBright`                                                                    | ✅ Done |
| T8.12 | Update `CLAUDE.md` + `docs/projects/README.md`                                                                                                                                         | ✅ Done |

### Phase 2 — Cell component registry

| ID    | Task                                                                                                                                                                                            | Status  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T8.13 | Extend `ServiceRegistry` — add `constructors` map + `getConstructor()` method                                                                                                                   | ✅ Done |
| T8.14 | Move each provider into its own subfolder (`spotify/`, `youtube/`, `ytdlp/`, etc.) and co-locate cell components (`SpotifyCell.tsx`, `YoutubeCell.tsx`, `YtDlpCell.tsx`, `MusicBrainzCell.tsx`) | ✅ Done |
| T8.15 | Add `static readonly cellComponent` to `SpotifyService`, `YoutubeService`, `YtDlpService`                                                                                                       | ✅ Done |
| T8.16 | `ServiceRegistry.register()` reads `static cellComponent` — stored alongside constructor                                                                                                        | ✅ Done |
| T8.17 | Remove `SERVICE_COLUMN_COMPONENTS` from `musicDownloadFlow.ts` — replace fallback with `registry.getConstructor(key)?.cellComponent ?? GenericProviderCell`                                     | ✅ Done |
| T8.18 | Delete old flat service files and `columns/providers/` directory                                                                                                                                | ✅ Done |

### Phase 3 — URL parser registry

| ID    | Task                                                                                                                                                                                                                       | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| T8.19 | Create `src/base/urlParser.ts` — `ParsedUrl` type, `UrlParserRegistry` class, `urlParserRegistry` singleton, builtin parsers for soundcloud/deezer/appleMusic/tidal                                                        | ✅ Done |
| T8.20 | Replace abstract `getType(url)` in `MetadataService` with `static parseUrl(url): ParsedUrl \| null` on the base class (throws) + concrete `getType` derived from it via `this.constructor`                                 | ✅ Done |
| T8.21 | Add `static parseUrl` to `SpotifyService` (absorbs `extractTrackIdFromUrl`, adds album/playlist detection) and `YoutubeService` (absorbs `extractVideoIdFromUrl`, distinguishes youtube vs youtubeMusic, handles youtu.be) | ✅ Done |
| T8.22 | Add stub `parseUrl` to disabled services (`MusicBrainzService`, `SonglinkService`)                                                                                                                                         | ✅ Done |
| T8.23 | `ServiceRegistry.register()` reads `static parseUrl` and registers it in `urlParserRegistry`                                                                                                                               | ✅ Done |
| T8.24 | Rewrite `detectUrls.ts` to delegate entirely to `urlParserRegistry` — remove hardcoded `classify()`                                                                                                                        | ✅ Done |

## How to add a new provider

1. Create a service class extending `MetadataService` or `DownloadService` in its own subfolder under `services/`
2. Add `static readonly display: ProviderDisplay = { label, acronym, color, colorSubtle, colorBright }`
3. Add `static parseUrl(url): ParsedUrl | null` — return the platform/type/id if the URL matches, `null` otherwise
4. Add `static readonly cellComponent = MyCell` with a co-located cell component file
5. Add `.register('myKey', MyService)` in `MusicDownloadFlow`'s constructor

Everything else (display info, URL classification, column cell) flows automatically from that single registration.
