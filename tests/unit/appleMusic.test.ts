import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    parseAppleMusicUrl,
    appleMusicStorefront,
} from "#flows/musicDownloadFlow/services/metadata-providers/appleMusic/appleMusicUrl";
import {
    convertAppleMusicToTrack,
    slimITunesResult,
    type ITunesResult,
} from "#flows/musicDownloadFlow/services/metadata-providers/appleMusic/convertAppleMusicToTrack";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";

// What `GET https://itunes.apple.com/lookup?id=697195787&entity=song&country=us` really answered (trimmed).
const HBFS = {
    wrapperType: "track",
    kind: "song",
    artistId: 5468295,
    collectionId: 697194953,
    trackId: 697195787,
    artistName: "Daft Punk",
    collectionName: "Discovery",
    trackName: "Harder Better Faster Stronger",
    artistViewUrl: "https://music.apple.com/us/artist/daft-punk/5468295?uo=4",
    collectionViewUrl: "https://music.apple.com/us/album/harder-better-faster-stronger/697194953?i=697195787&uo=4",
    trackViewUrl: "https://music.apple.com/us/album/harder-better-faster-stronger/697194953?i=697195787&uo=4",
    previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/x.m4a",
    trackPrice: 1.29,
    releaseDate: "2001-02-26T08:00:00Z",
    discCount: 1,
    discNumber: 1,
    trackCount: 14,
    trackNumber: 4,
    trackTimeMillis: 224693,
    primaryGenreName: "Dance",
} as ITunesResult;

describe("parseAppleMusicUrl", () => {
    test("reads a track in its album, and a song page", () => {
        for (const url of [
            "https://music.apple.com/us/album/harder-better-faster-stronger/697194953?i=697195787",
            "https://music.apple.com/fr/album/discovery/697194953?i=697195787&l=en",
            "https://music.apple.com/album/697194953?i=697195787",
            "https://music.apple.com/us/song/harder-better-faster-stronger/697195787",
            "https://music.apple.com/us/song/697195787",
            "https://itunes.apple.com/us/album/discovery/id697194953?i=697195787",
        ]) {
            expect(parseAppleMusicUrl(url)).toEqual({ platform: "appleMusic", type: "track", id: "697195787" });
        }
    });

    test("an album without `?i=` is an album", () => {
        expect(parseAppleMusicUrl("https://music.apple.com/us/album/discovery/697194953")).toEqual({
            platform: "appleMusic",
            type: "album",
            id: "697194953",
        });
    });

    test("playlists, artists, other sites and text are not read", () => {
        for (const url of [
            "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",
            "https://music.apple.com/us/artist/daft-punk/5468295",
            "https://music.apple.com/us/browse",
            "https://music.apple.com/us/album/discovery/697194953?i=abc",
            "https://www.apple.com/music/",
            "https://open.spotify.com/track/x",
            "nonsense",
        ]) {
            expect(parseAppleMusicUrl(url)).toBeNull();
        }
    });

    test("the store comes from the link, US when it says none", () => {
        expect(appleMusicStorefront("https://music.apple.com/fr/song/1")).toBe("fr");
        expect(appleMusicStorefront("https://music.apple.com/song/1")).toBe("us");
    });
});

describe("convertAppleMusicToTrack", () => {
    test("maps a song: title, artist, duration, album, and a url without the tracking parameter", () => {
        const track = convertAppleMusicToTrack(slimITunesResult(HBFS))!;
        expect(track).toMatchObject({
            id: "697195787",
            trackName: "Harder Better Faster Stronger",
            duration: 224693,
            trackNumber: 4,
            url: "https://music.apple.com/us/album/harder-better-faster-stronger/697194953?i=697195787",
            uri: "APPLEMUSIC::TRACK::697195787",
            platform: "appleMusic",
            apiProvider: "itunes",
            genres: ["Dance"],
            album: {
                id: "697194953",
                albumName: "Discovery",
                releaseDate: "2001-02-26",
                url: "https://music.apple.com/us/album/harder-better-faster-stronger/697194953",
            },
        });
        expect(track.artists).toEqual([
            {
                type: "artist",
                name: "Daft Punk",
                id: "5468295",
                url: "https://music.apple.com/us/artist/daft-punk/5468295",
            },
        ]);
    });

    test("several credited artists are split", () => {
        const track = convertAppleMusicToTrack({ ...HBFS, artistName: "Kanye West, Jay-Z & Frank Ocean" });
        expect(track?.artists.map((a) => a.name)).toEqual(["Kanye West", "Jay-Z", "Frank Ocean"]);
    });

    test("an album, a video or a song without id or title is not a track", () => {
        expect(convertAppleMusicToTrack({ ...HBFS, wrapperType: "collection" })).toBeNull();
        expect(convertAppleMusicToTrack({ ...HBFS, kind: "music-video" })).toBeNull();
        expect(convertAppleMusicToTrack({ ...HBFS, trackId: undefined })).toBeNull();
        expect(convertAppleMusicToTrack({ ...HBFS, trackName: "" })).toBeNull();
    });
});

const itunesGet = vi.fn();
vi.mock("#flows/musicDownloadFlow/services/apis/itunes-client", () => ({
    itunesGet: (endpoint: string, params: unknown) => itunesGet(endpoint, params),
}));

async function makeService() {
    const { AppleMusicService } =
        await import("#flows/musicDownloadFlow/services/metadata-providers/appleMusic/AppleMusicService");
    const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
    const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger.createChild = () => logger;
    return new AppleMusicService({ getStatus: () => status, id: "t" } as never, logger as never);
}

const seed = (trackName: string, artist: string) =>
    ({
        id: "dz1",
        trackName,
        artists: [{ type: "artist", name: artist }],
        url: "https://www.deezer.com/track/1",
        platform: "deezer",
        apiProvider: "deezer",
        fetchedAt: new Date(),
        type: "track",
    }) as unknown as TrackMetadata;

describe("AppleMusicService", () => {
    beforeEach(async () => {
        itunesGet.mockReset();
        const { setCacheEnabled } = await import("#utils/cache");
        setCacheEnabled(false);
    });

    test("getTrackMetadata looks the song up in the link's store", async () => {
        itunesGet.mockResolvedValue({ resultCount: 1, results: [HBFS] });
        const track = await (
            await makeService()
        ).getTrackMetadata("https://music.apple.com/fr/album/discovery/697194953?i=697195787");
        expect(itunesGet).toHaveBeenCalledWith("lookup", { id: "697195787", entity: "song", country: "fr" });
        expect(track.uri).toBe("APPLEMUSIC::TRACK::697195787");
    });

    test("a song missing from the link's store is looked up in the US store", async () => {
        itunesGet.mockImplementation(async (_e: string, p: { country: string }) =>
            p.country === "us" ? { results: [HBFS] } : { results: [] }
        );
        const track = await (await makeService()).getTrackMetadata("https://music.apple.com/jp/song/697195787");
        expect(itunesGet).toHaveBeenCalledTimes(2);
        expect(track.id).toBe("697195787");
    });

    test("an unknown song is an error, an album link is not a track", async () => {
        itunesGet.mockResolvedValue({ results: [] });
        const service = await makeService();
        await expect(service.getTrackMetadata("https://music.apple.com/us/song/1")).rejects.toThrow(/no track/);
        await expect(service.getTrackMetadata("https://music.apple.com/us/album/x/697194953")).rejects.toThrow();
    });

    test("searchTrack keeps the hits that look like the track, best first", async () => {
        itunesGet.mockResolvedValue({
            results: [
                { ...HBFS, trackId: 1, trackName: "Harder Better Faster Stronger (Alive 2007 Radio Edit)" },
                HBFS,
                { ...HBFS, trackId: 3, trackName: "Get Lucky", artistName: "Someone Else" },
            ],
        });
        const results = await (await makeService()).searchTrack(seed("Harder Better Faster Stronger", "Daft Punk"));
        expect(results[0].metadata.id).toBe("697195787");
        expect(results.map((r) => r.metadata.id)).not.toContain("3");
    });

    test("expandCollection lists an album's songs in order", async () => {
        const { AppleMusicService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/appleMusic/AppleMusicService");
        itunesGet.mockResolvedValue({
            results: [
                { wrapperType: "collection", collectionName: "Discovery", artistName: "Daft Punk" },
                { ...HBFS, trackId: 2, trackNumber: 2 },
                { ...HBFS, trackId: 1, trackNumber: 1 },
            ],
        });
        const expansion = await AppleMusicService.expandCollection(
            "https://music.apple.com/us/album/discovery/697194953",
            { info: vi.fn() } as never,
            {} as never
        );
        expect(expansion).toMatchObject({ kind: "album", name: "Discovery", ownerName: "Daft Punk", totalCount: 2 });
        expect(expansion.trackUrls).toEqual(["https://music.apple.com/us/song/1", "https://music.apple.com/us/song/2"]);
    });
});
