import type { Platform } from '../../services/apis/songlink-client';
import { MusicBrainzRecording } from '../../services/musicbrainz';


// Standard Track type definition
export interface StandardTrack {
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

export interface Source {
    platform: Platform;
    track: StandardTrack;
    fetchedAt: Date;
}