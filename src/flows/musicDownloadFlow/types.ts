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
    extension: "flac";
    sourceUrl?: string;
};

export type FileInfo = {
    format: "flac" | "mp3" | "ogg";
    sizeBytes: number;
    durationMs: number;
    embeddedTags: Record<string, string | string[]>;
};

export type SavedFile = {
    path: string;
    savedAt: Date;
};

export type TrackDownloadSource = {
    state: "pending" | "searching" | "downloading" | "downloaded" | "failed";
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
};

//----------------------//
//         TASK         //
//----------------------//

// Structured task-level uri, used for the log-line prefix. Distinct from the
// metadata-level `TrackUri` string brand: this is derived from the recognized
// input URL (and refined once primary metadata is fetched).
export type TrackUriParts = {
    platform: Platform;
    type: "track";
    id: string;
};

export type TrackDownloadTask = {
    state: "pending" | "running" | "finished" | "failed";
    /** Structured uri of the track once recognized; undefined falls back to the URL. */
    uri?: TrackUriParts;
    /** Registry key of the metadata service that recognized the input URL. */
    recognizedServiceKey?: string;
    primaryMetadataInProgress?: boolean;
    metadataDiscoveringInProgress?: boolean;
    primaryMetadataFetched?: boolean;
    metadataDiscovered?: boolean;
    downloadsFetched?: boolean;
    toTag?: boolean;
    toDownload?: boolean;
    userInput: UserInput;
    // Recognized at import time from the URL (before any fetch). Both are set
    // together, or both absent ⇒ the URL was not recognized by any service ("Unknown").
    uri?: TrackUriParts; // structured URI, e.g. { platform: "spotify", type: "track", id: "123" }
    recognizedServiceKey?: string; // registry key that matched & will fetch (e.g. "youtube")
    metadataGroups: MetadataGroupState[];
    metadataOverride: MetadataOverrides;
    downloadSources: TrackDownloadSource[];
    parentAlbumDownloadTask?: AlbumDownloadTask;
};

export type TracksDownloadTask = {
    state: "pending" | "running" | "finished" | "failed";
    toTag?: boolean;
    toDownload?: boolean;
    userInput: UserInput;
    metadataGroups: MetadataGroupState[];
    metadataOverride: MetadataOverrides;
    downloadSources: TrackDownloadSource[];
    tracks: TrackDownloadTask[];
};

export type AlbumDownloadTask = TracksDownloadTask;
// export type PlaylistDownloadTask = TracksDownloadTask
// export type LivePlaylistDownloadTask = PlaylistDownloadTask

export type MusicDownloadTaskAttributes = TrackDownloadTask; // | AlbumDownloadTask
