import { IRecordingMatch, IReleaseGroupMatch, IRelease } from "musicbrainz-api";

//----------------------//
//     MUSICBRAINZ      //
//----------------------//

export type MusicBrainzReleaseGroup = IReleaseGroupMatch;
export type MusicBrainzRelease = IRelease;
export type MusicBrainzRecording = IRecordingMatch;

//----------------------//
//         BASE         //
//----------------------//

// Standard Track type definition
export interface BaseTrack {
    id: string;
    isrc?: string;
    trackName: string;
    duration?: number; // ms
    trackNumber?: number;
    url: string;
    uri?: string;
    artists: StandardArtist[];
    album?: StandardAlbum;
    linksByPlatform?: Partial<Record<Platform, string>>;
    localRelativePath?: string;
    musicBrainzRecording?: MusicBrainzRecording;
}

export type StandardTrack = BaseTrack;

export interface StandardArtist {
    id?: string;
    type: "artist";
    name: string;
    url?: string;
    uri?: string;
}

export interface StandardAlbum {
    id: string;
    albumType?: string;
    albumName: string;
    totalTracks?: number;
    releaseDate?: string;
    url: string;
    uri: string;
    artists?: StandardArtist[];
}

//----------------------//
//    RAW USER INPUT    //
//----------------------//

export type UrlInput = {
    type: "url";
    url: string; // track, album, playlist
};

export type UserInput = UrlInput;

//----------------------//
//       METADATA       //
//----------------------//

export type Platform =
    | "musicBrainz"
    | "spotify"
    | "itunes"
    | "appleMusic"
    | "youtube"
    | "youtubeMusic"
    | "google"
    | "googleStore"
    | "pandora"
    | "deezer"
    | "tidal"
    | "amazonStore"
    | "amazonMusic"
    | "soundcloud"
    | "napster"
    | "yandex"
    | "spinrilla"
    | "audius"
    | "audiomack"
    | "anghami"
    | "boomplay"
    | "bandcamp";

export type APIProvider =
    | "musicBrainz"
    | "spotify"
    | "itunes"
    | "youtube"
    | "google"
    | "pandora"
    | "deezer"
    | "tidal"
    | "amazon"
    | "soundcloud"
    | "napster"
    | "yandex"
    | "spinrilla"
    | "audius"
    | "audiomack"
    | "anghami"
    | "boomplay"
    | "bandcamp"
    | "songlink"
    | "spotifyUrlInfo";

export type TrackUri<PlatformString extends string = string> = `${Uppercase<PlatformString>}::TRACK::${string}`;

// Structured, round-trippable form of a track URI. Stored on a task at import time
// for handy field access; serialize to/from the canonical "PLATFORM::TRACK::ID"
// string via formatTrackUri()/parseTrackUri() (utils/trackUri.ts).
export type TrackUriParts = {
    platform: Platform; // exact casing, e.g. "spotify", "youtubeMusic"
    type: "track";
    id: string; // platform-specific id
};

export type BaseTrackMetadata = {
    id: string; // "4rye8ZgoRgbQPfgBqxjfqG"
    isrc?: string; // "FRT092400049"
    trackName: string;
    duration?: number; // in milliseconds
    trackNumber?: number;
    url: string;
    uri?: TrackUri; // "SPOTIFY::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
    nativeAppUriDesktop?: string; // "spotify:track:4rye8ZgoRgbQPfgBqxjfqG"
    nativeAppUriMobile?: string;
    artists: StandardArtist[];
    album?: StandardAlbum;
    platform: Platform;
    apiProvider: APIProvider;
    // If set and different from apiProvider, this metadata was fetched by the indicated service
    // (e.g. Songlink discovered the track, real enrichment not yet done)
    fetchedBy?: APIProvider;
    fetchedAt: Date;
    type: "track";
    bpm?: number;
    key?: string;
    genres?: string[];
};

export type MusicBrainzTrackMetadata = BaseTrackMetadata & {
    platform: "musicBrainz";
    apiProvider: "musicBrainz";
    uri: TrackUri<"musicBrainz">; // "MUSICBRAINZ::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
    musicBrainzRecording?: MusicBrainzRecording;
};

export type SpotifyTrackMetadata = BaseTrackMetadata & {
    platform: "spotify";
    apiProvider: "spotify";
    uri: TrackUri<"spotify">; // "SPOTIFY::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
};

export type DeezerTrackMetadata = BaseTrackMetadata & {
    platform: "deezer";
    apiProvider: "deezer";
    uri: TrackUri<"deezer">; // "DEEZER::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
};

export type AppleMusicTrackMetadata = BaseTrackMetadata & {
    platform: "appleMusic";
    apiProvider: "itunes";
};

export type YoutubeTrackMetadata = BaseTrackMetadata & {
    platform: "youtube";
    apiProvider: "youtube";
    uri: TrackUri<"youtube">; // "YOUTUBE::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
};

export type YoutubeMusicTrackMetadata = BaseTrackMetadata & {
    platform: "youtubeMusic";
    apiProvider: "youtube";
    uri: TrackUri<"youtubeMusic">; // "YOUTUBEMUSIC::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
};

export type SoundcloudTrackMetadata = BaseTrackMetadata & {
    platform: "soundcloud";
    apiProvider: "soundcloud";
    uri: TrackUri<"soundcloud">; // "SOUNDCLOUD::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
};

export type TidalTrackMetadata = BaseTrackMetadata & {
    platform: "tidal";
    apiProvider: "tidal";
    uri: TrackUri<"tidal">; // "TIDAL::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
};

export type TrackMetadata =
    | MusicBrainzTrackMetadata
    | SpotifyTrackMetadata
    | DeezerTrackMetadata
    | AppleMusicTrackMetadata
    | YoutubeTrackMetadata
    | YoutubeMusicTrackMetadata
    | SoundcloudTrackMetadata
    | TidalTrackMetadata;

//----------------------//
//  SEARCH & DISCOVERY  //
//----------------------//

// Which fields of the source metadata were used to find a result
export type SearchKey =
    | "url"
    | "isrc"
    | "trackName"
    | "artistName"
    | "trackName+artistName"
    | "trackName+artistName+isrc";

// One path that led to a given URI being discovered
export type DiscoverySource = {
    discoveredBy: string; // service key: "spotify", "songlink", "youtube"
    fromUri: string; // source URI used as input: "SPOTIFY::TRACK::abcd"
    searchKeys: SearchKey[]; // which fields drove this search
};

// One result within a platform group
export type MetadataResultState = {
    metadata: TrackMetadata;
    isPrimaryInput: boolean; // true only for the user's original URL input
    isFavorited: boolean; // max 1 per group
    isRejected: boolean;
    rank: number; // within-group ordering (lower = higher priority)
    confidence?: number; // 0–100 vs primary input metadata
    discoverySources: DiscoverySource[]; // empty for the primary input result
    fetchState?: "loading" | "error";
    fetchError?: string;
};

// A group of results for one platform
export type MetadataGroupState = {
    platform: Platform;
    serviceKey: string; // "spotify", "youtube"
    rank: number; // cross-group ordering (lower = higher priority)
    results: MetadataResultState[];
};

// Return type for MetadataService.searchTrack
export type SearchTrackResult = {
    metadata: TrackMetadata;
    searchKeys: SearchKey[]; // which fields of the source metadata drove this search
};

export type DiscoveryAnchor = {
    state: "found" | "notFound" | "error";
    url?: string;
    id?: string;
    openUri?: string;
    count?: number;
};

export type DiscoveryResult = {
    tracks: TrackMetadata[];
    anchor?: DiscoveryAnchor;
};

export type MetadataOverrides = Partial<{
    trackName: string;
    artists: StandardArtist[];
    duration: number;
    isrc: string;
    album: StandardAlbum;
    year: number;
    trackNumber: number;
    bpm: number;
    key: string;
    genres: string[];
}>;

//----------------------//
//       DOWNLOAD       //
//----------------------//

export type DownloadProvider = "ytdlp" | "soulseek";

export type LocalFile = {
    state: "found" | "not_found";
    path: string;
    name: string;
    extension: "flac" | "mp3";
    sourceUrl?: string;
};

// How trustworthy a source's audio quality actually is, independent of its
// container. "lossy-transcode" means a lossless container (e.g. FLAC) wraps
// audio that was already lossy-compressed upstream (e.g. yt-dlp's FLAC is a
// re-encode of YouTube's Opus stream) — the container lies about quality.
export type Provenance = "lossless" | "lossy-transcode" | "lossy";

export type FileInfo = {
    format: "flac" | "mp3" | "ogg";
    sizeBytes: number;
    durationMs: number;
    embeddedTags: Record<string, string | string[]>;
    /** Real codec probed from the file itself (e.g. "flac", "mp3", "opus"), independent of container. */
    codec?: string;
    /** Real bitrate probed from the file itself. */
    bitrateKbps?: number;
    provenance?: Provenance;
    /**
     * For "lossy-transcode" sources: the known original lossy codec upstream of
     * this file's container (e.g. "Opus" for yt-dlp). Not derivable by probing
     * the file itself — it's been genuinely re-encoded — so it's supplied by
     * the service that knows where the file actually came from.
     */
    sourceCodec?: string;
};

export type SavedFile = {
    path: string;
    savedAt: Date;
};

export type TrackDownloadSource = {
    /**
     * "pending": queued, will still be attempted.
     * "skipped": a candidate a provider found and ranked but deliberately never
     *            attempted because an earlier, better-ranked one already succeeded
     *            (e.g. unattempted Soulseek candidates once one download wins).
     *            Terminal — distinct from "pending" precisely so the UI doesn't
     *            claim it's still queued or in progress.
     */
    state: "pending" | "searching" | "downloading" | "downloaded" | "failed" | "skipped";
    provider: DownloadProvider;
    track: TrackMetadata;
    localFile?: LocalFile;
    downloadedAt: Date;
    selected: boolean;
    isRejected?: boolean;
    fileInfo?: FileInfo;
    savedFile?: SavedFile;
    /** Download progress 0–100 while `state` is "downloading". */
    progress?: number;
    /** Extra provider-specific origin detail (e.g. the Soulseek peer username this file came from). */
    providerDetail?: string;
    /**
     * Opaque, provider-specific data needed to retry this exact candidate on demand
     * (e.g. the Soulseek peer/file reference for a "skipped" or "failed" row) —
     * meaningless outside the `DownloadService` that produced it; pass back to that
     * same service's `retryCandidate()`.
     */
    retryPayload?: unknown;
};

//----------------------//
//         TASK         //
//----------------------//

export type TrackDownloadTask = {
    kind: "track";
    state: "pending" | "running" | "finished" | "failed" | "stopped";
    /**
     * Structured uri set at import time from the recognized URL. Refined once primary
     * metadata is fetched. Both uri and recognizedServiceKey are set together, or both
     * absent (URL unrecognized → "Unknown").
     */
    uri?: TrackUriParts;
    /** Registry key of the metadata service that recognized the input URL (e.g. "spotify", "youtube"). */
    recognizedServiceKey?: string;
    /** Set when this track was created by a CollectionTask's expansion — the parent's task id. */
    parentTaskId?: string;
    primaryMetadataInProgress?: boolean;
    metadataDiscoveringInProgress?: boolean;
    primaryMetadataFetched?: boolean;
    metadataDiscovered?: boolean;
    downloadsFetched?: boolean;
    toTag?: boolean;
    toDownload?: boolean;
    userInput: UserInput;
    metadataGroups: MetadataGroupState[];
    metadataOverride: MetadataOverrides;
    downloadSources: TrackDownloadSource[];
    discoveryAnchors?: Record<string, DiscoveryAnchor>;
};

//----------------------//
//      COLLECTION      //
//----------------------//

export type CollectionLiveRefresh = {
    enabled: boolean;
    lastFetchedAt?: Date;
};

// A parent task for an album/playlist URL. Doesn't fetch track metadata itself —
// fetching (via CollectionTask.start()/refetch()) spawns real TrackDownloadTask
// children (tagged parentTaskId) into the same flat orchestrator queue.
export type CollectionDownloadTask = {
    kind: "collection";
    collectionKind: "album" | "playlist";
    state: "pending" | "running" | "finished" | "failed" | "stopped";
    userInput: UserInput;
    /** Registry key of the metadata service that recognized the input URL. */
    recognizedServiceKey?: string;
    name?: string;
    ownerName?: string;
    totalCount?: number;
    truncated?: boolean;
    /** Ids of child TrackDownloadTasks created by this collection, in discovery order. */
    childTaskIds: string[];
    /** Hides childTaskIds rows in the task list when true. */
    collapsed?: boolean;
    /** Inherited by every child created from this point on (fresh expand or refetch). */
    toTag?: boolean;
    toDownload?: boolean;
    /** Playlists only — periodic re-fetch via liveRefreshScheduler. */
    live?: CollectionLiveRefresh;
    error?: string;
};

export type MusicDownloadTaskAttributes = TrackDownloadTask | CollectionDownloadTask;
