import { TrackMetadata, TrackUri, Platform, APIProvider, StandardArtist } from "#flows/musicDownloadFlow/types";
import type { IRecording } from "musicbrainz-api";

// Maps a streaming-platform URL to the Platform key we use internally, extracting the
// platform-native track id so the produced URI matches what each metadata service emits.
type PlatformMatch = { platform: Platform; id: string };

// The natural metadata provider for each discoverable platform (mirrors the *TrackMetadata unions).
const PLATFORM_API_PROVIDER: Partial<Record<Platform, APIProvider>> = {
    spotify: "spotify",
    youtube: "youtube",
    youtubeMusic: "youtube",
    deezer: "deezer",
    tidal: "tidal",
    appleMusic: "itunes",
    soundcloud: "soundcloud",
};

function detectPlatform(rawUrl: string): PlatformMatch | null {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname;

    if (host === "open.spotify.com" || host.endsWith(".spotify.com")) {
        const m = path.match(/\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/);
        if (m) return { platform: "spotify", id: m[1] };
    }
    if (host === "music.youtube.com") {
        const id = parsed.searchParams.get("v");
        if (id) return { platform: "youtubeMusic", id };
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
        const id = parsed.searchParams.get("v");
        if (id) return { platform: "youtube", id };
    }
    if (host === "youtu.be") {
        const id = path.slice(1);
        if (id) return { platform: "youtube", id };
    }
    if (host === "deezer.com" || host.endsWith(".deezer.com")) {
        const m = path.match(/\/track\/(\d+)/);
        if (m) return { platform: "deezer", id: m[1] };
    }
    if (host === "tidal.com" || host.endsWith(".tidal.com")) {
        const m = path.match(/\/track\/(\d+)/);
        if (m) return { platform: "tidal", id: m[1] };
    }
    if (host === "music.apple.com") {
        // .../album/<name>/<albumId>?i=<trackId>  or  .../song/<name>/<trackId>
        const songId = parsed.searchParams.get("i") ?? path.match(/\/song\/[^/]+\/(\d+)/)?.[1];
        if (songId) return { platform: "appleMusic", id: songId };
    }
    if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) {
        const slug = path.replace(/^\/+|\/+$/g, "");
        if (slug) return { platform: "soundcloud", id: slug };
    }

    return null;
}

function parseArtistCredit(recording: IRecording): StandardArtist[] {
    const credits = recording["artist-credit"];
    if (!credits) return [];
    return credits
        .map((c) => c.name ?? c.artist?.name)
        .filter((name): name is string => !!name && name.length > 0)
        .map((name) => ({ type: "artist" as const, name }));
}

/**
 * Builds rudimentary, per-platform TrackMetadata from a MusicBrainz recording's URL relationships.
 * Each result carries `fetchedBy: "musicBrainz"` to mark it as discovered (not yet enriched).
 */
export function extractTracksFromMusicBrainzRecording(recording: IRecording): TrackMetadata[] {
    const artists = parseArtistCredit(recording);
    const seen = new Set<Platform>();
    const results: TrackMetadata[] = [];

    for (const relation of recording.relations ?? []) {
        const resource = relation.url?.resource;
        if (!resource) continue;

        const match = detectPlatform(resource);
        if (!match) continue;

        const apiProvider = PLATFORM_API_PROVIDER[match.platform];
        if (!apiProvider) continue;

        // MusicBrainz can list several links for the same service — keep only the first per platform.
        if (seen.has(match.platform)) continue;
        seen.add(match.platform);

        // Normalize youtubeMusic → youtube so URIs match what YoutubeService produces.
        const uriPrefix = match.platform === "youtubeMusic" ? "youtube" : match.platform;
        const uri = `${uriPrefix.toUpperCase()}::TRACK::${match.id}` as TrackUri;

        results.push({
            id: match.id,
            trackName: recording.title ?? "",
            artists,
            url: resource,
            uri,
            platform: match.platform,
            apiProvider,
            fetchedBy: "musicBrainz",
            fetchedAt: new Date(),
            type: "track",
        } as unknown as TrackMetadata);
    }

    return results;
}
