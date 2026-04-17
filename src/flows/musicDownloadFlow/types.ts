import { MusicBrainzRecording } from './services/metadata-providers/musicbrainz';

//----------------------//
//      DEPRECATED      //
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
    linksByPlatform?: Partial<Record<Platform, string>>
    localRelativePath?: string
    musicBrainzRecording?: MusicBrainzRecording
}

export type StandardTrack = BaseTrack

export interface StandardArtist {
    id?: string;
    type: 'artist';
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

export type DownloadTaskAttributes = {
    toTag?: boolean;
    toDownload?: boolean;
    track?: StandardTrack;
}

//----------------------//
//    RAW USER INPUT    //
//----------------------//

export type UrlInput = {
    type: 'url';
    url: string; // track, album, playlist
}

export type UserInput = UrlInput

//----------------------//
//       METADATA       //
//----------------------//

export type Platform =
    | 'musicBrainz'
    | 'spotify'
    | 'itunes'
    | 'appleMusic'
    | 'youtube'
    | 'youtubeMusic'
    | 'google'
    | 'googleStore'
    | 'pandora'
    | 'deezer'
    | 'tidal'
    | 'amazonStore'
    | 'amazonMusic'
    | 'soundcloud'
    | 'napster'
    | 'yandex'
    | 'spinrilla'
    | 'audius'
    | 'audiomack'
    | 'anghami'
    | 'boomplay'
    | 'bandcamp';

export type APIProvider =
    | 'musicBrainz'
    | 'spotify'
    | 'itunes'
    | 'youtube'
    | 'google'
    | 'pandora'
    | 'deezer'
    | 'tidal'
    | 'amazon'
    | 'soundcloud'
    | 'napster'
    | 'yandex'
    | 'spinrilla'
    | 'audius'
    | 'audiomack'
    | 'anghami'
    | 'boomplay'
    | 'bandcamp';

export type TrackUri<PlatformString extends string = string> = `${Uppercase<PlatformString>}::TRACK::${string}`;

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
    isPrimarySource?: boolean; // metadata from the primary source (e.g. the URL provided by the user)
    fetchedAt: Date;
    type: 'track';
}

export type MusicBrainzTrackMetadata = BaseTrackMetadata & {
    platform: 'musicBrainz';
    apiProvider: 'musicBrainz';
    uri: TrackUri<'musicBrainz'>; // "MUSICBRAINZ::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
    musicBrainzRecording?: MusicBrainzRecording
}

export type SpotifyTrackMetadata = BaseTrackMetadata & {
    platform: 'spotify';
    apiProvider: 'spotify';
    uri: TrackUri<'spotify'>; // "SPOTIFY::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
}

export type DeezerTrackMetadata = BaseTrackMetadata & {
    platform: 'deezer';
    apiProvider: 'deezer';
    uri: TrackUri<'deezer'>; // "DEEZER::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
}

export type AppleMusicTrackMetadata = BaseTrackMetadata & {
    platform: 'appleMusic';
    apiProvider: 'itunes';
}

export type YoutubeTrackMetadata = BaseTrackMetadata & {
    platform: 'youtube';
    apiProvider: 'youtube';
    uri: TrackUri<'youtube'>; // "YOUTUBE::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
}

export type YoutubeMusicTrackMetadata = BaseTrackMetadata & {
    platform: 'youtubeMusic';
    apiProvider: 'youtube';
    uri: TrackUri<'youtubeMusic'>; // "YOUTUBEMUSIC::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
}

export type SoundcloudTrackMetadata = BaseTrackMetadata & {
    platform: 'soundcloud';
    apiProvider: 'soundcloud';
    uri: TrackUri<'soundcloud'>; // "SOUNDCLOUD::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
}

export type TidalTrackMetadata = BaseTrackMetadata & {
    platform: 'tidal';
    apiProvider: 'tidal';
    uri: TrackUri<'tidal'>; // "TIDAL::TRACK::4rye8ZgoRgbQPfgBqxjfqG"
}

export type TrackMetadata = MusicBrainzTrackMetadata | SpotifyTrackMetadata | DeezerTrackMetadata | AppleMusicTrackMetadata | YoutubeTrackMetadata | YoutubeMusicTrackMetadata | SoundcloudTrackMetadata | TidalTrackMetadata;


//----------------------//
//       DOWNLOAD       //
//----------------------//

export type DownloadProvider = 'ytdlp' | 'soulseek';

export type LocalFile = {
    state: "found" | "not_found";
    path: string;
    name: string;
    extension: 'flac';
    sourceUrl?: string;
}

export type TrackDownloadSource = {
    state: 'pending' | 'searching' | 'downloading' | 'downloaded' | 'failed';
    provider: DownloadProvider;
    track: TrackMetadata;
    localFile?: LocalFile
    downloadedAt: Date;
    selected: boolean;
}


//----------------------//
//         TASK         //
//----------------------//

export type TrackDownloadTask = {
    toTag?: boolean;
    toDownload?: boolean;
    userInput: UserInput;
    metadataSources: TrackMetadata[];
    downloadSources: TrackDownloadSource[];
    parentAlbumDownloadTask?: AlbumDownloadTask;
}

export type TracksDownloadTask = {
    state: 'pending' | 'running' | 'finished' | 'failed';
    toTag?: boolean;
    toDownload?: boolean;
    userInput: UserInput;
    metadataSources: TrackMetadata[];
    downloadSources: TrackDownloadSource[];
    tracks: TrackDownloadTask[];
}

export type AlbumDownloadTask = TracksDownloadTask
// export type PlaylistDownloadTask = TracksDownloadTask
// export type LivePlaylistDownloadTask = PlaylistDownloadTask

export type MusicDownloadTaskAttributes = TrackDownloadTask // | AlbumDownloadTask
