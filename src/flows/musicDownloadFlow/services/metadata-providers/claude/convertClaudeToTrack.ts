import { platformRegistry } from "#base/platformRegistry";
import { urlParserRegistry } from "#base/urlParser";
import type { APIProvider, Platform, TrackMetadata, TrackUri } from "#flows/musicDownloadFlow/types";

/** One link Claude says it found, as returned by the structured-output schema. */
export type ClaudeLink = {
    platform: string;
    url: string;
    confidence: number;
    evidence?: string;
};

// Below this the model is telling us it is guessing; a wrong link costs the user more than a gap.
export const MIN_LINK_CONFIDENCE = 0.5;

// A service's alias platforms (e.g. "youtubeMusic") share its URIs; each service also declares how to
// build its canonical track URL. Platforms that declare none keep the URL as Claude gave it.
const normalizePlatform = (platform: string): string => platformRegistry.canonical(platform);

function canonicalUrl(platform: string, id: string, original: string): string {
    return platformRegistry.trackUrl(platform, id) ?? original;
}

/**
 * Turns Claude's links into rudimentary TrackMetadata (URL + identity only, no title/artist) for the
 * pipeline to enrich through the platform's own metadata service. Nothing Claude says about the track
 * is trusted beyond "this URL might be it": links are re-parsed by the same URL parsers the app uses
 * for pasted links, restricted to the platforms that were asked for, and deduplicated. A link that
 * does not resolve to a real track fails enrichment downstream and is dropped there.
 */
export function claudeLinksToTracks(links: ClaudeLink[], wanted: Platform[]): TrackMetadata[] {
    const wantedSet = new Set(wanted.map(normalizePlatform));
    const seen = new Set<string>();
    const tracks: TrackMetadata[] = [];

    for (const link of links) {
        if (typeof link?.url !== "string" || !(link.confidence >= MIN_LINK_CONFIDENCE)) continue;

        const parsed = urlParserRegistry.parse(link.url.trim());
        if (!parsed || parsed.type !== "track" || !parsed.id) continue;

        const platform = normalizePlatform(parsed.platform);
        if (wantedSet.size > 0 && !wantedSet.has(platform)) continue;

        const uri = `${platform.toUpperCase()}::TRACK::${parsed.id}` as TrackUri;
        if (seen.has(uri)) continue;
        seen.add(uri);

        tracks.push({
            id: parsed.id,
            trackName: "",
            artists: [],
            url: canonicalUrl(platform, parsed.id, link.url.trim()),
            uri,
            platform: platform as Platform,
            apiProvider: platform as APIProvider,
            fetchedBy: "claude",
            fetchedAt: new Date(),
            type: "track",
        } as unknown as TrackMetadata);
    }

    return tracks;
}
