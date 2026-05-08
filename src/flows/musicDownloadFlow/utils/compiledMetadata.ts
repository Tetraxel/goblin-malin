import { Platform, MetadataSourceState, MetadataOverrides, TrackMetadata, StandardArtist, StandardAlbum } from '../types';

export type FieldAttribution = Platform | 'manual' | 'none';

export type CompiledMetadataField =
    | 'trackName'
    | 'artists'
    | 'duration'
    | 'isrc'
    | 'album'
    | 'year'
    | 'trackNumber'
    | 'bpm'
    | 'key'
    | 'genres';

export type MusicBrainzIds = {
    recording?: string;
    release?: string;
    artist?: string;
    releaseGroup?: string;
};

export type CompiledMetadata = {
    trackName: string;
    artists: StandardArtist[];
    duration?: number;
    isrc?: string;
    album?: StandardAlbum;
    year?: number;
    trackNumber?: number;
    bpm?: number;
    key?: string;
    genres?: string[];
    musicBrainzIds?: MusicBrainzIds;
    attribution: Partial<Record<CompiledMetadataField, FieldAttribution>>;
};

function extractYear(releaseDate: string | undefined): number | undefined {
    if (!releaseDate) return undefined;
    const year = parseInt(releaseDate.split('-')[0]);
    return isNaN(year) ? undefined : year;
}

function pickFirst<T>(
    sorted: MetadataSourceState[],
    getter: (m: TrackMetadata) => T | undefined | null,
): { value: T | undefined; platform: Platform | undefined } {
    for (const s of sorted) {
        const v = getter(s.metadata);
        if (v !== null && v !== undefined) {
            return { value: v as T, platform: s.metadata.platform };
        }
    }
    return { value: undefined, platform: undefined };
}

export function computeCompiledMetadata(
    sources: MetadataSourceState[],
    overrides: MetadataOverrides,
): CompiledMetadata {
    // 1. Filter out rejected sources
    const active = sources.filter(s => !s.isRejected);

    // 2. Sort by rank ascending (lower rank = higher priority)
    const sorted = [...active].sort((a, b) => a.rank - b.rank);

    const attribution: Partial<Record<CompiledMetadataField, FieldAttribution>> = {};

    const trackNameR = pickFirst(sorted, m => m.trackName || undefined);
    const artistsR = pickFirst(sorted, m => m.artists.length > 0 ? m.artists : undefined);
    const durationR = pickFirst(sorted, m => m.duration);
    const isrcR = pickFirst(sorted, m => m.isrc);
    const albumR = pickFirst(sorted, m => m.album);
    const yearR = pickFirst(sorted, m => extractYear(m.album?.releaseDate));
    const trackNumberR = pickFirst(sorted, m => m.trackNumber);
    const bpmR = pickFirst(sorted, m => m.bpm);
    const keyR = pickFirst(sorted, m => m.key);
    const genresR = pickFirst(sorted, m => m.genres && m.genres.length > 0 ? m.genres : undefined);

    if (trackNameR.platform) attribution.trackName = trackNameR.platform;
    if (artistsR.platform) attribution.artists = artistsR.platform;
    if (durationR.platform) attribution.duration = durationR.platform;
    if (isrcR.platform) attribution.isrc = isrcR.platform;
    if (albumR.platform) attribution.album = albumR.platform;
    if (yearR.platform) attribution.year = yearR.platform;
    if (trackNumberR.platform) attribution.trackNumber = trackNumberR.platform;
    if (bpmR.platform) attribution.bpm = bpmR.platform;
    if (keyR.platform) attribution.key = keyR.platform;
    if (genresR.platform) attribution.genres = genresR.platform;

    // 3. Build compiled result from sources
    const compiled: CompiledMetadata = {
        trackName: trackNameR.value ?? '',
        artists: artistsR.value ?? [],
        duration: durationR.value,
        isrc: isrcR.value,
        album: albumR.value,
        year: yearR.value,
        trackNumber: trackNumberR.value,
        bpm: bpmR.value,
        key: keyR.value,
        genres: genresR.value,
        attribution,
    };

    // 4. Apply overrides on top
    if (overrides.trackName !== undefined) { compiled.trackName = overrides.trackName; attribution.trackName = 'manual'; }
    if (overrides.artists !== undefined) { compiled.artists = overrides.artists; attribution.artists = 'manual'; }
    if (overrides.duration !== undefined) { compiled.duration = overrides.duration; attribution.duration = 'manual'; }
    if (overrides.isrc !== undefined) { compiled.isrc = overrides.isrc; attribution.isrc = 'manual'; }
    if (overrides.album !== undefined) { compiled.album = overrides.album; attribution.album = 'manual'; }
    if (overrides.year !== undefined) { compiled.year = overrides.year; attribution.year = 'manual'; }
    if (overrides.trackNumber !== undefined) { compiled.trackNumber = overrides.trackNumber; attribution.trackNumber = 'manual'; }
    if (overrides.bpm !== undefined) { compiled.bpm = overrides.bpm; attribution.bpm = 'manual'; }
    if (overrides.key !== undefined) { compiled.key = overrides.key; attribution.key = 'manual'; }
    if (overrides.genres !== undefined) { compiled.genres = overrides.genres; attribution.genres = 'manual'; }

    return compiled;
}
