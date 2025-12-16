import { SongFull as YoutubeTrack } from 'ytmusic-api';
import type { Track as SpotifyTrack } from "@spotify/web-api-ts-sdk";
import { StandardTrack } from '../types';
import { YoutubeService } from "../../../services/youtube";
import { SpotifyService } from "../../../services/spotify";
import type { SonglinkResponse, Entity, APIProvider, Platform } from '../../../services/apis/songlink-client';


// Priority order for fallback sources
const FALLBACK_PRIORITY: APIProvider[] = [
    'tidal',
    'itunes',
    'spotify',
    'deezer',
    'soundcloud',
    'youtube'
];

function extractSpotifyId(entitiesByUniqueId: Record<string, Entity>): string | null {
    const spotifyEntity = Object.entries(entitiesByUniqueId).find(
        ([key]) => key.startsWith('SPOTIFY_SONG::')
    );

    return spotifyEntity ? spotifyEntity[1].id : null;
}

function extractYoutubeMusicId(entitiesByUniqueId: Record<string, Entity>): string | null {
    const entity = Object.entries(entitiesByUniqueId).find(
        ([key]) => key.startsWith('YOUTUBE_VIDEO::')
    );

    return entity ? entity[1].id : null;
}


// Converts Spotify Track to Standard Track format
function convertSpotifyTrack(spotifyTrack: SpotifyTrack, spotifyUrl: string): StandardTrack {
    return {
        id: spotifyTrack.id,
        isrc: spotifyTrack.external_ids?.isrc,
        trackName: spotifyTrack.name,
        duration: spotifyTrack.duration_ms,
        trackNumber: spotifyTrack.track_number,
        url: spotifyUrl,
        uri: spotifyTrack.uri,
        album: {
            id: spotifyTrack.album.id,
            albumType: spotifyTrack.album.album_type,
            albumName: spotifyTrack.album.name,
            totalTracks: spotifyTrack.album.total_tracks,
            releaseDate: spotifyTrack.album.release_date,
            url: spotifyTrack.album.external_urls?.spotify || '',
            uri: spotifyTrack.album.uri || `spotify:album:${spotifyTrack.album.id}`,
            artists: spotifyTrack.album.artists.map(artist => ({
                id: artist.id,
                type: 'artist' as const,
                name: artist.name,
                url: artist.external_urls?.spotify,
                uri: artist.uri || `spotify:artist:${artist.id}`
            }))
        },
        artists: spotifyTrack.artists.map(artist => ({
            id: artist.id,
            type: 'artist' as const,
            name: artist.name,
            url: artist.external_urls?.spotify,
            uri: artist.uri || `spotify:artist:${artist.id}`
        }))
    };
}

/**
 * Separates a string of artists into an array.
 * Handles commas, ampersands, and surrounding whitespace.
 */
const parseYoutubeArtistString = (input: string): string[] => {
    if (!input) return [];

    return input
        // 1. Split by comma (,) OR ampersand (&)
        // The '+' allows it to treat consecutive separators (like ", &") as one break
        .split(/[,&]+/)
        // 2. Remove whitespace from the start and end of each artist
        .map((artist) => artist.trim())
        // 3. Remove any empty strings that might result from trailing separators
        .filter((artist) => artist.length > 0);
};

// Converts YouTube Music Song to Standard Track format
export function convertYoutubeTrack(youtubeTrack: YoutubeTrack): StandardTrack {
    const artistNames = parseYoutubeArtistString(youtubeTrack.artist.name)
    return {
        id: youtubeTrack.videoId,
        trackName: youtubeTrack.name,
        duration: youtubeTrack.duration * 1000, // seconds to milliseconds
        url: `https://music.youtube.com/watch?v=${youtubeTrack.videoId}`,
        uri: `youtube:track:${youtubeTrack.videoId}`,
        artists: [
            // Main artist
            {
                id: youtubeTrack.artist.artistId || undefined,
                type: 'artist' as const,
                name: artistNames[0],
                url: youtubeTrack.artist.artistId
                    ? `https://music.youtube.com/channel/${youtubeTrack.artist.artistId}`
                    : undefined,
                uri: youtubeTrack.artist.artistId
                    ? `youtube:artist:${youtubeTrack.artist.artistId}`
                    : undefined
            },
            // Other artists don't have much information on Youtube
            ...artistNames.slice(1).map((artistName) => ({
                id: undefined,
                type: 'artist' as const,
                name: artistName,
                url: undefined,
                uri: undefined
            }))
        ]
    };
}

export async function getLinksByPlatforms(
    track: StandardTrack,
    linksByPlatform: SonglinkResponse['linksByPlatform'],
    youtubeService: YoutubeService,
): Promise<StandardTrack['linksByPlatform']> {
    const result: StandardTrack['linksByPlatform'] = {};

    if (!linksByPlatform) return result;

    for (const [platform, linkData] of Object.entries(linksByPlatform)) {
        if (linkData && linkData.url) {
            // Songlink don't finds the youtube music track,
            // the solution is to call the youtube music API to find the trackId
            if (platform == 'youtubeMusic') {
                const trackResults = await youtubeService.searchTracks(`${track.artists[0].name} ${track.trackName}`)
                const trackId = trackResults[0].videoId // TODO: search can be improved with partial matching
                const trackLink = trackId ? `https://music.youtube.com/watch?v=${trackId}` : undefined
                result['youtubeMusic'] = trackLink;
            }
            else
                result[platform as Platform] = linkData.url;
        }
    }

    return result;
}

// Finds the best fallback entity based on priority
function findFallbackEntity(entities: Record<string, Entity>): [string, Entity] | null {
    for (const provider of FALLBACK_PRIORITY) {
        const entry = Object.entries(entities).find(
            ([key, entity]) => entity.apiProvider === provider
        );
        if (entry) return entry;
    }
    return Object.entries(entities)[0] || null;
}

// Parses artist names from a string (handles "feat.", commas, "&")
function parseArtistNames(artistName: string): string[] {
    // Split by common separators and clean up
    return artistName
        .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
        .map(name => name.trim())
        .filter(name => name.length > 0);
}

// Converts fallback entity to Standard Track format
function convertFallbackEntity(
    entityUniqueId: string,
    entity: Entity,
    response: SonglinkResponse
): StandardTrack {
    const artistNames = parseArtistNames(entity.artistName || 'Unknown Artist');

    // Find the platform link for this entity
    const platformLink = Object.values(response.linksByPlatform).find(
        link => link.entityUniqueId === entityUniqueId
    );

    return {
        id: entity.id,
        trackName: entity.title || 'Unknown Track',
        url: platformLink?.url || response.pageUrl,
        uri: undefined,
        artists: artistNames.map(name => ({
            type: 'artist' as const,
            name
        }))
    };
}

export async function convertSonglinkToTrack(
    response: SonglinkResponse,
    spotifyService: SpotifyService,
    youtubeService: YoutubeService,
): Promise<StandardTrack> {
    const track = await convertSonglinkToBestTrack(response, spotifyService, youtubeService)
    track.linksByPlatform = await getLinksByPlatforms(track, response.linksByPlatform, youtubeService)
    return track
}

// Choose the best provider to get the track metadata
async function convertSonglinkToBestTrack(
    response: SonglinkResponse,
    spotifyService: SpotifyService,
    youtubeService: YoutubeService,
): Promise<StandardTrack> {
    // Priority 1: Try Spotify API
    const spotifyId = extractSpotifyId(response.entitiesByUniqueId);

    if (spotifyId) {
        try {
            const spotifyTrack = await spotifyService.getTrackInfo(spotifyId);
            if (spotifyTrack) {
                const spotifyUrl = response.linksByPlatform.spotify?.url ||
                    `https://open.spotify.com/track/${spotifyId}`;
                return convertSpotifyTrack(spotifyTrack, spotifyUrl);
            }
        } catch (error) {
            console.warn('Failed to fetch Spotify track info:', error);
            // Continue to fallback
        }
    }

    // Priority 2: Try Youtube Music API
    const youtubeMusicId = extractYoutubeMusicId(response.entitiesByUniqueId);
    if (youtubeMusicId) {
        try {
            const youtubeTrack = await youtubeService.getSong(youtubeMusicId)
            // await fs.writeFile('samples/youtubeTrack2.json', JSON.stringify(youtubeTrack, null, 2));

            return convertYoutubeTrack(youtubeTrack)
        } catch (error) {
            console.warn('Failed to fetch Youtube track info:', error);
            // Continue to fallback
        }
    }

    // Fallback to entities in SonglinkResponse
    const fallbackEntry = findFallbackEntity(response.entitiesByUniqueId);

    if (!fallbackEntry) {
        throw new Error('No valid entities found in SonglinkResponse');
    }

    const [entityUniqueId, entity] = fallbackEntry;
    return convertFallbackEntity(entityUniqueId, entity, response);
}


// Synchronous version (when Spotify API is not available)
export function convertSonglinkToTrackSync(
    response: SonglinkResponse
): StandardTrack {
    const fallbackEntry = findFallbackEntity(response.entitiesByUniqueId);

    if (!fallbackEntry) {
        throw new Error('No valid entities found in SonglinkResponse');
    }

    const [entityUniqueId, entity] = fallbackEntry;
    return convertFallbackEntity(entityUniqueId, entity, response);
}