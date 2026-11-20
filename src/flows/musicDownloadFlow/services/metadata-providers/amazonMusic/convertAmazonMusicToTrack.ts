import { type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { type SonglinkResponse } from "../../apis/songlink-client";
import { amazonMusicTrackUri } from "./amazonMusicUrl";

/** What Songlink says about an Amazon Music track: only what the app reads. */
export type AmazonMusicSong = { id: string; title?: string; artistName?: string };

/**
 * The Amazon Music song in a Songlink answer for an Amazon link, or `null` when Songlink knows none (it then answers
 * with the other platforms only, or not at all).
 */
export function amazonSongFromSonglink(response: SonglinkResponse, asin: string): AmazonMusicSong | null {
    const link = response.linksByPlatform.amazonMusic;
    const entity =
        (link && response.entitiesByUniqueId[link.entityUniqueId]) ??
        Object.values(response.entitiesByUniqueId).find((e) => e.apiProvider === "amazon" && e.id === asin);
    if (!entity || entity.type !== "song") return null;
    return { id: entity.id, title: entity.title, artistName: entity.artistName };
}

/** "A, B & C" → three names: Songlink gives every credited artist in one text. */
function splitArtists(text: string | undefined): string[] {
    return (text ?? "")
        .split(/\s*(?:,|&)\s*/)
        .map((name) => name.trim())
        .filter(Boolean);
}

/** Maps what Songlink says about an Amazon Music track to the app's metadata, or `null` without a title. */
export function convertAmazonMusicToTrack(song: AmazonMusicSong, asin: string): TrackMetadata | null {
    const title = song.title?.trim();
    if (!title) return null;
    return {
        id: asin,
        trackName: title,
        url: `https://music.amazon.com/tracks/${asin}`,
        uri: amazonMusicTrackUri(asin),
        artists: splitArtists(song.artistName).map((name) => ({ type: "artist" as const, name })),
        platform: "amazonMusic",
        apiProvider: "amazon",
        fetchedAt: new Date(),
        type: "track",
    };
}
