import { type StandardArtist, type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { tidalTrackUri } from "./tidalUrl";

/** The schema.org description of a track that Tidal's public page carries (`<script type="application/ld+json">`). */
export type TidalRecording = {
    "@type"?: string;
    "@id"?: string;
    url?: string;
    name?: string;
    /** ISO 8601 duration ("PT3M34S"). */
    duration?: string;
    isrcCode?: string;
    byArtist?: { name?: string; url?: string }[] | { name?: string; url?: string };
    inAlbum?: { name?: string; url?: string; datePublished?: string };
    datePublished?: string;
};

/** Every JSON-LD block of a page, as parsed objects (a block that does not parse is skipped). */
function jsonLdBlocks(html: string): unknown[] {
    const blocks: unknown[] = [];
    const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(pattern)) {
        try {
            blocks.push(JSON.parse(match[1]));
        } catch {
            // Not JSON: ignored.
        }
    }
    return blocks;
}

/**
 * The `MusicRecording` of a Tidal track page, slimmed to what the app reads, or `null` when the page has none (a page
 * that is not a track, or one Tidal changed).
 */
export function extractTidalRecording(html: string): TidalRecording | null {
    const candidates = jsonLdBlocks(html).flatMap((block) => {
        const graph = (block as { "@graph"?: unknown[] })?.["@graph"];
        return Array.isArray(graph) ? graph : [block];
    });
    const recording = candidates.find((c) => (c as TidalRecording)?.["@type"] === "MusicRecording") as
        TidalRecording | undefined;
    if (!recording) return null;
    const artists = Array.isArray(recording.byArtist)
        ? recording.byArtist
        : recording.byArtist
          ? [recording.byArtist]
          : [];
    return {
        "@type": recording["@type"],
        url: recording.url,
        name: recording.name,
        duration: recording.duration,
        isrcCode: recording.isrcCode,
        byArtist: artists.map((a) => ({ name: a.name, url: a.url })),
        inAlbum: recording.inAlbum
            ? {
                  name: recording.inAlbum.name,
                  url: recording.inAlbum.url,
                  datePublished: recording.inAlbum.datePublished,
              }
            : undefined,
        datePublished: recording.datePublished,
    };
}

/** "PT3M34S" → 214000 ms; undefined when it is not an ISO 8601 duration. */
export function parseIsoDuration(text: string | undefined): number | undefined {
    const match = text ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(text.trim()) : null;
    if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
    const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    return seconds > 0 ? Math.round(seconds * 1000) : undefined;
}

/** The last number of a Tidal address (`…/artist/afterhour-chillout/7345430` → `7345430`). */
function lastNumber(url: string | undefined): string | undefined {
    return url?.match(/\/(\d+)\/?$/)?.[1];
}

/** Maps a Tidal page's recording to the app's metadata, or `null` when it has no title. `id` is the track's id. */
export function convertTidalToTrack(recording: TidalRecording, id: string): TrackMetadata | null {
    const title = recording.name?.trim();
    if (!title) return null;

    const artists: StandardArtist[] = (Array.isArray(recording.byArtist) ? recording.byArtist : [])
        .filter((a) => a.name?.trim())
        .map((a) => {
            const artistId = lastNumber(a.url);
            return {
                type: "artist" as const,
                name: a.name!.trim(),
                ...(artistId ? { id: artistId } : {}),
                ...(a.url ? { url: a.url } : {}),
            };
        });

    const albumId = lastNumber(recording.inAlbum?.url);
    const albumName = recording.inAlbum?.name?.trim();

    return {
        id,
        isrc: recording.isrcCode || undefined,
        trackName: title,
        duration: parseIsoDuration(recording.duration),
        url: `https://tidal.com/track/${id}`,
        uri: tidalTrackUri(id),
        nativeAppUriDesktop: `tidal://track/${id}`,
        artists,
        album:
            albumId && albumName
                ? {
                      id: albumId,
                      albumName,
                      releaseDate: recording.inAlbum?.datePublished ?? recording.datePublished,
                      url: `https://tidal.com/album/${albumId}`,
                      uri: `tidal:album:${albumId}`,
                  }
                : undefined,
        platform: "tidal",
        apiProvider: "tidal",
        fetchedAt: new Date(),
        type: "track",
    };
}
