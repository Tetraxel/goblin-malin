import { beforeEach, describe, expect, test, vi } from "vitest";
import { parseAmazonMusicUrl } from "#flows/musicDownloadFlow/services/metadata-providers/amazonMusic/amazonMusicUrl";
import {
    amazonSongFromSonglink,
    convertAmazonMusicToTrack,
} from "#flows/musicDownloadFlow/services/metadata-providers/amazonMusic/convertAmazonMusicToTrack";
import { extractTracksFromSonglinkResponse } from "#flows/musicDownloadFlow/services/metadata-providers/songlink/convertSonglinkToTrack";
import type { SonglinkResponse } from "#flows/musicDownloadFlow/services/apis/songlink-client";

// The shape Songlink answers for an Amazon Music link (its documented response; the app could not call it live here).
const SONGLINK: SonglinkResponse = {
    entityUniqueId: "AMAZON_SONG::B07DN7XVCC",
    userCountry: "US",
    pageUrl: "https://song.link/us/i/1",
    linksByPlatform: {
        amazonMusic: {
            country: "US",
            entityUniqueId: "AMAZON_SONG::B07DN7XVCC",
            url: "https://music.amazon.com/albums/B07DNBK8LQ?trackAsin=B07DN7XVCC&do=play",
        },
    },
    entitiesByUniqueId: {
        "AMAZON_SONG::B07DN7XVCC": {
            id: "B07DN7XVCC",
            type: "song",
            title: "Internal Calm",
            artistName: "Afterhour Chillout & Friend",
            apiProvider: "amazon",
            platforms: ["amazonMusic"],
        },
    },
};

describe("parseAmazonMusicUrl", () => {
    test("reads a track page and a track shown in its album, on any country site", () => {
        for (const url of [
            "https://music.amazon.com/tracks/B07DN7XVCC",
            "https://music.amazon.fr/tracks/B07DN7XVCC?ref=x",
            "https://music.amazon.co.uk/tracks/B07DN7XVCC/",
            "https://music.amazon.com/albums/B07DNBK8LQ?trackAsin=B07DN7XVCC&do=play",
        ]) {
            expect(parseAmazonMusicUrl(url)).toEqual({ platform: "amazonMusic", type: "track", id: "B07DN7XVCC" });
        }
    });

    test("albums, playlists, artists, the shop and text are not read", () => {
        for (const url of [
            "https://music.amazon.com/albums/B07DNBK8LQ",
            "https://music.amazon.com/playlists/B01M11SBC8",
            "https://music.amazon.com/artists/B000QJPZ1S",
            "https://music.amazon.com/tracks/short",
            "https://www.amazon.com/dp/B07DN7XVCC",
            "https://music.amazon.evil.com/tracks/B07DN7XVCC",
            "amazon",
        ]) {
            expect(parseAmazonMusicUrl(url)).toBeNull();
        }
    });
});

describe("an Amazon Music track from Songlink", () => {
    test("maps title and artists, with the track's canonical page", () => {
        const song = amazonSongFromSonglink(SONGLINK, "B07DN7XVCC")!;
        expect(convertAmazonMusicToTrack(song, "B07DN7XVCC")).toMatchObject({
            id: "B07DN7XVCC",
            trackName: "Internal Calm",
            url: "https://music.amazon.com/tracks/B07DN7XVCC",
            uri: "AMAZONMUSIC::TRACK::B07DN7XVCC",
            platform: "amazonMusic",
            apiProvider: "amazon",
            artists: [
                { type: "artist", name: "Afterhour Chillout" },
                { type: "artist", name: "Friend" },
            ],
        });
    });

    test("Songlink's discovery now keeps the Amazon Music link, under the id this service gives it", () => {
        const [track] = extractTracksFromSonglinkResponse(SONGLINK);
        expect(track).toMatchObject({ platform: "amazonMusic", uri: "AMAZONMUSIC::TRACK::B07DN7XVCC" });
    });

    test("no Amazon song in the answer: nothing", () => {
        expect(amazonSongFromSonglink({ ...SONGLINK, linksByPlatform: {}, entitiesByUniqueId: {} }, "X")).toBeNull();
    });
});

const songlinkGet = vi.fn();
vi.mock("#flows/musicDownloadFlow/services/apis/songlink-client", () => ({
    SonglinkClient: class {
        get(params: URLSearchParams) {
            return songlinkGet(params.get("url"));
        }
    },
}));

describe("AmazonMusicService", () => {
    beforeEach(async () => {
        songlinkGet.mockReset();
        const { setCacheEnabled } = await import("#utils/cache");
        setCacheEnabled(false);
    });

    async function load() {
        return import("#flows/musicDownloadFlow/services/metadata-providers/amazonMusic/AmazonMusicService");
    }

    test("is off until the user allows it: it sends links to song.link", async () => {
        const { AmazonMusicService } = await load();
        expect(AmazonMusicService.defaultSettings.enabled.defaultValue).toBe(false);
        expect(AmazonMusicService.consent?.message).toMatch(/api\.song\.link/);
    });

    test("getTrackMetadata asks Songlink about the track's canonical page", async () => {
        const { AmazonMusicService } = await load();
        songlinkGet.mockResolvedValue(SONGLINK);
        const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
        const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        logger.createChild = () => logger;
        const service = new AmazonMusicService({ getStatus: () => status, id: "t" } as never, logger as never);
        const track = await service.getTrackMetadata("https://music.amazon.fr/albums/B07DNBK8LQ?trackAsin=B07DN7XVCC");
        expect(songlinkGet).toHaveBeenCalledWith("https://music.amazon.com/tracks/B07DN7XVCC");
        expect(track.trackName).toBe("Internal Calm");

        songlinkGet.mockResolvedValue({ ...SONGLINK, linksByPlatform: {}, entitiesByUniqueId: {} });
        await expect(service.getTrackMetadata("https://music.amazon.com/tracks/B000000000")).rejects.toThrow(
            /does not know/
        );
    });
});
