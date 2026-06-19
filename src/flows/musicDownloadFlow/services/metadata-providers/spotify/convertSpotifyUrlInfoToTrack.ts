import { type Details } from "../../apis/spotify-url-info-client";
import { TrackMetadata, TrackUri } from "#flows/musicDownloadFlow/types";

function parseArtistNames(artistName: string | undefined): { type: "artist"; name: string }[] {
    if (!artistName) return [];
    return artistName
        .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
        .map((n) => n.trim())
        .filter((n) => n.length > 0)
        .map((name) => ({ type: "artist" as const, name }));
}

function extractTrackId(url: string): string | null {
    try {
        const parsed = new URL(url);
        const trackMatch = parsed.pathname.match(/\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/);
        return trackMatch ? trackMatch[1] : null;
    } catch {
        return null;
    }
}

/**
 * @param options.isFallback When true, this result is a fallback after the official Spotify API
 *   was unavailable, so `apiProvider` stays `"spotify"` and `fetchedBy` differs — this is what
 *   surfaces the "Spotify is not available…" note. When false (the user deliberately chose the
 *   scrape mode), `apiProvider` is set to `"spotifyUrlInfo"` so no "not available" note is shown.
 */
export function convertSpotifyUrlInfoToTrack(
    url: string,
    details: Details,
    options: { isFallback?: boolean } = {}
): TrackMetadata {
    const track = details.tracks[0];
    const id = extractTrackId(url) ?? track.uri?.split(":").pop() ?? "";

    return {
        id,
        trackName: track.name,
        artists: parseArtistNames(track.artist),
        duration: track.duration,
        url,
        uri: `SPOTIFY::TRACK::${id}` as TrackUri<"spotify">,
        nativeAppUriDesktop: `spotify:track:${id}`,
        platform: "spotify",
        apiProvider: options.isFallback ? "spotify" : "spotifyUrlInfo",
        fetchedBy: "spotifyUrlInfo",
        fetchedAt: new Date(),
        type: "track",
    } as unknown as TrackMetadata;
}
