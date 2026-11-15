import { type CompiledMetadata } from "../utils/compiledMetadata";

/**
 * MusicBrainz's "Tag lookup" search page, prefilled with what the metadata sources say about the track — the same form
 * Picard fills from a file's tags. Opened in the user's browser, it lets them look the track up by hand when the
 * automatic check found nothing (or the wrong thing).
 */
const TAG_LOOKUP_URL = "https://musicbrainz.org/taglookup/index";

/** The tag-lookup address for a track, or undefined when there is no title or artist to look for. */
export function tagLookupUrl(
    compiled: Pick<CompiledMetadata, "trackName" | "artists" | "album" | "trackNumber" | "duration">
): string | undefined {
    const artist = compiled.artists
        .map((a) => a.name)
        .filter(Boolean)
        .join(", ");
    if (!compiled.trackName || !artist) return undefined;

    const params = new URLSearchParams();
    params.set("tag-lookup.artist", artist);
    params.set("tag-lookup.release", compiled.album?.albumName ?? "");
    params.set("tag-lookup.tracknum", compiled.trackNumber != null ? String(compiled.trackNumber) : "");
    params.set("tag-lookup.track", compiled.trackName);
    params.set("tag-lookup.duration", compiled.duration != null ? String(Math.round(compiled.duration)) : "");
    params.set("tag-lookup.filename", "");
    return `${TAG_LOOKUP_URL}?${params.toString()}`;
}
