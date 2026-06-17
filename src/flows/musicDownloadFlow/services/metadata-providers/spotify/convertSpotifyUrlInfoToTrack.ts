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

export function convertSpotifyUrlInfoToTrack(url: string, details: Details): TrackMetadata {
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
        apiProvider: "spotify",
        fetchedBy: "spotifyUrlInfo",
        fetchedAt: new Date(),
        type: "track",
    } as unknown as TrackMetadata;
}
