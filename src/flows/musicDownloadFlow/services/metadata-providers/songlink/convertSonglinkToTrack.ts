import { TrackMetadata, TrackUri, Platform, APIProvider } from "#flows/musicDownloadFlow/types";
import type { SonglinkResponse, Entity, PlatformLink } from "../../apis/songlink-client";

// Platforms we can produce TrackMetadata for (union members we know about)
const SUPPORTED_PLATFORMS = new Set<string>([
    "spotify",
    "youtube",
    "youtubeMusic",
    "deezer",
    "tidal",
    "soundcloud",
    "appleMusic",
    "itunes",
]);

function parseArtistNames(artistName: string | undefined): string[] {
    if (!artistName) return [];
    return artistName
        .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
}

export function convertSonglinkEntityToTrackMetadata(
    platformKey: string,
    platformLink: PlatformLink,
    entity: Entity
): TrackMetadata | null {
    if (!SUPPORTED_PLATFORMS.has(platformKey)) return null;

    const artistNames = parseArtistNames(entity.artistName);
    const platform = platformKey as Platform;
    const apiProvider = entity.apiProvider as APIProvider;
    // Normalize youtubeMusic → youtube so URIs match what YoutubeService produces
    const uriPrefix = platformKey === "youtubeMusic" ? "youtube" : platformKey;
    const uri = `${uriPrefix.toUpperCase()}::TRACK::${entity.id}` as TrackUri;

    return {
        id: entity.id,
        trackName: entity.title ?? "",
        artists: artistNames.map((name) => ({ type: "artist" as const, name })),
        url: platformLink.url,
        uri,
        platform,
        apiProvider,
        fetchedBy: "songlink",
        fetchedAt: new Date(),
        type: "track",
        nativeAppUriDesktop: platformLink.nativeAppUriDesktop,
        nativeAppUriMobile: platformLink.nativeAppUriMobile,
    } as unknown as TrackMetadata;
}

export function extractTracksFromSonglinkResponse(response: SonglinkResponse): TrackMetadata[] {
    const results: TrackMetadata[] = [];

    for (const [platformKey, platformLink] of Object.entries(response.linksByPlatform)) {
        if (!platformLink) continue;

        const entity = response.entitiesByUniqueId[platformLink.entityUniqueId];
        if (!entity || entity.type !== "song") continue;

        const metadata = convertSonglinkEntityToTrackMetadata(platformKey, platformLink, entity);
        if (metadata) results.push(metadata);
    }

    return results;
}
