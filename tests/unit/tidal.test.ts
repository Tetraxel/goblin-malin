import { beforeEach, describe, expect, test, vi } from "vitest";
import { parseTidalUrl, tidalOpenUri } from "#flows/musicDownloadFlow/services/metadata-providers/tidal/tidalUrl";
import {
    convertTidalToTrack,
    extractTidalRecording,
    parseIsoDuration,
} from "#flows/musicDownloadFlow/services/metadata-providers/tidal/convertTidalToTrack";

// The JSON-LD block of `https://tidal.com/track/77646168`, exactly as the page carried it, in a trimmed page.
const PAGE = `<!DOCTYPE html><html><head><title>Internal Calm by Afterhour Chillout on TIDAL</title>
<meta property="og:type" content="music.song">
<script type="application/ld+json">{"@context":"https://schema.org","@id":"https://tidal.com/track/77646168","@type":"MusicRecording","url":"https://tidal.com/track/77646168","byArtist":[{"@id":"https://tidal.com/artist/afterhour-chillout/7345430","@type":"MusicGroup","name":"Afterhour Chillout","url":"https://tidal.com/artist/afterhour-chillout/7345430"}],"duration":"PT3M34S","image":"https://resources.tidal.com/images/6b8a4883/0e65/4764/a8e2/98ea78e9ca54/640x640.jpg","inAlbum":{"@id":"https://tidal.com/album/soft-chill-out-relaxing-music-stress-relief-peaceful-mind/77646153","@type":"MusicAlbum","name":"Soft Chill Out – Relaxing Music, Stress Relief, Peaceful Mind, Deep Sleep, Meditation, Ambient Music, Sensitive Music to Calm Down","url":"https://tidal.com/album/soft-chill-out-relaxing-music-stress-relief-peaceful-mind/77646153"},"isrcCode":"PLL431541907","name":"Internal Calm"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[]}</script>
</head><body></body></html>`;

describe("parseTidalUrl", () => {
    test("reads a track on every host and path Tidal uses", () => {
        for (const url of [
            "https://tidal.com/track/77646168",
            "https://tidal.com/browse/track/77646168",
            "https://www.tidal.com/browse/track/77646168/",
            "https://listen.tidal.com/track/77646168?u",
            "https://listen.tidal.com/album/77646153/track/77646168",
            "https://embed.tidal.com/tracks/77646168",
            "https://tidal.com/track/77646168/u",
            "https://tidal.com/browse/track/77646168/u?foo=1",
            "https://tidal.com/us/track/77646168",
            "https://tidal.com/album/77646153/track/77646168/u",
        ]) {
            expect(parseTidalUrl(url)).toEqual({ platform: "tidal", type: "track", id: "77646168" });
        }
    });

    test("albums, playlists, artists, videos, other sites and text are not read", () => {
        for (const url of [
            "https://tidal.com/browse/album/77646153",
            "https://tidal.com/playlist/0b5df380-47d3-48fe-ae66-8f0dba90b1ee",
            "https://tidal.com/artist/7345430",
            "https://tidal.com/video/1234",
            "https://tidal.com/track/abc",
            "https://example.com/track/1",
            "tidal",
        ]) {
            expect(parseTidalUrl(url)).toBeNull();
        }
    });

    test("the desktop app opens a track", () => {
        expect(tidalOpenUri({ platform: "tidal", type: "track", id: "1" })).toBe("tidal://track/1");
    });
});

describe("a Tidal track page", () => {
    test("its recording maps to title, artist, duration, ISRC and album", () => {
        const recording = extractTidalRecording(PAGE)!;
        const track = convertTidalToTrack(recording, "77646168")!;
        expect(track).toMatchObject({
            id: "77646168",
            trackName: "Internal Calm",
            isrc: "PLL431541907",
            duration: 214_000,
            url: "https://tidal.com/track/77646168",
            uri: "TIDAL::TRACK::77646168",
            platform: "tidal",
            apiProvider: "tidal",
            album: { id: "77646153", url: "https://tidal.com/album/77646153" },
        });
        expect(track.artists).toEqual([
            {
                type: "artist",
                name: "Afterhour Chillout",
                id: "7345430",
                url: "https://tidal.com/artist/afterhour-chillout/7345430",
            },
        ]);
    });

    test("a page without a recording, or one whose JSON is broken, has none", () => {
        expect(extractTidalRecording("<html><title>TIDAL</title></html>")).toBeNull();
        expect(extractTidalRecording('<script type="application/ld+json">{oops</script>')).toBeNull();
    });

    test("ISO 8601 durations", () => {
        expect(parseIsoDuration("PT3M34S")).toBe(214_000);
        expect(parseIsoDuration("PT1H0M2.5S")).toBe(3_602_500);
        expect(parseIsoDuration("PT")).toBeUndefined();
        expect(parseIsoDuration("3:34")).toBeUndefined();
    });
});

const fetchMock = vi.fn();
vi.mock("#utils/timeout", async (importOriginal) => ({
    ...(await importOriginal<typeof import("#utils/timeout")>()),
    fetchWithTimeout: () => fetchMock,
}));

describe("TidalService", () => {
    beforeEach(async () => {
        fetchMock.mockReset();
        const { setCacheEnabled } = await import("#utils/cache");
        setCacheEnabled(false);
    });

    async function makeService() {
        const { TidalService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/tidal/TidalService");
        const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
        const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        logger.createChild = () => logger;
        return new TidalService({ getStatus: () => status, id: "t" } as never, logger as never);
    }

    test("getTrackMetadata reads the track's canonical page", async () => {
        fetchMock.mockResolvedValue(new Response(PAGE, { status: 200 }));
        const track = await (await makeService()).getTrackMetadata("https://listen.tidal.com/album/1/track/77646168");
        expect(String(fetchMock.mock.calls[0][0])).toBe("https://tidal.com/track/77646168");
        expect(track.trackName).toBe("Internal Calm");
    });

    test("a missing track and a page that is not a track are errors", async () => {
        const service = await makeService();
        fetchMock.mockResolvedValue(new Response("", { status: 404 }));
        await expect(service.getTrackMetadata("https://tidal.com/track/1")).rejects.toThrow(/no track/);
        fetchMock.mockResolvedValue(new Response("<html></html>", { status: 200 }));
        await expect(service.getTrackMetadata("https://tidal.com/track/2")).rejects.toThrow(/does not describe/);
    });

    test("searchTrack finds nothing on its own (Tidal's search needs a key)", async () => {
        const service = await makeService();
        const seed = { trackName: "x", artists: [{ type: "artist", name: "y" }] };
        expect(await service.searchTrack(seed as never)).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
