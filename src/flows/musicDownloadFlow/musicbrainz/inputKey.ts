import { type CompiledMetadata } from "../utils/compiledMetadata";

/**
 * A fingerprint of everything the MusicBrainz checks read from a track's compiled metadata: the title, the ISRC, the
 * artists (and their pages) and the album (its link, title, track count and barcode). Each verdict is stamped with
 * the fingerprint it was made from, so the UI can tell that the sources have changed since — a new source, a
 * reordering, an edited field — and offer a re-check. Two compiled metadata with the same key give the same checks.
 */
export function musicBrainzInputKey(
    compiled: Pick<CompiledMetadata, "trackName" | "artists" | "isrc" | "album">
): string {
    const { album } = compiled;
    return JSON.stringify([
        compiled.trackName,
        compiled.isrc ?? null,
        compiled.artists.map((a) => [a.name, a.url ?? null]),
        album ? [album.id, album.url, album.albumName, album.totalTracks ?? null, album.barcode ?? null] : null,
    ]);
}

/** Whether the compiled metadata has enough (a title and an album) for the checks to mean anything. */
export function canCheckMusicBrainz(compiled: Pick<CompiledMetadata, "trackName" | "album">): boolean {
    return !!compiled.trackName && !!compiled.album;
}

/**
 * True when the verdict was made from other metadata than the compiled metadata now holds. A verdict from before
 * fingerprints existed (no key) is not called stale: nothing is known about what it was made from.
 */
export function isMusicBrainzVerdictStale(
    identity: { inputKey?: string } | undefined,
    compiled: Pick<CompiledMetadata, "trackName" | "artists" | "isrc" | "album">
): boolean {
    return identity?.inputKey !== undefined && identity.inputKey !== musicBrainzInputKey(compiled);
}
