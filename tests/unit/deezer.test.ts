import { beforeEach, describe, expect, test, vi } from "vitest";
import { parseDeezerUrl, deezerOpenUri } from "#flows/musicDownloadFlow/services/metadata-providers/deezer/deezerUrl";
import {
    convertDeezerToTrack,
    slimDeezerTrack,
    type DeezerTrack,
} from "#flows/musicDownloadFlow/services/metadata-providers/deezer/convertDeezerToTrack";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";

// What `GET https://api.deezer.com/track/3135556` really answered (trimmed to the fields the app reads, plus a few it
// must drop).
const HBFS = {
    id: 3135556,
    readable: true,
    title: "Harder, Better, Faster, Stronger",
    isrc: "GBDUW0000059",
    link: "https://www.deezer.com/track/3135556",
    share: "https://www.deezer.com/track/3135556?utm_source=deezer&utm_content=track-3135556",
    duration: 226,
    track_position: 4,
    disk_number: 1,
    release_date: "2001-03-12",
    bpm: 0,
    preview: "https://cdnt-preview.dzcdn.net/api/1/1/6/a/2/0/6a2c.mp3",
    track_token: "AAAAAWsABnJr",
    contributors: [{ id: 27, name: "Daft Punk", link: "https://www.deezer.com/artist/27", role: "Main" }],
    artist: { id: 27, name: "Daft Punk", link: "https://www.deezer.com/artist/27" },
    album: { id: 302127, title: "Discovery", link: "https://www.deezer.com/album/302127", release_date: "2001-03-07" },
    type: "track",
} as DeezerTrack;

// An entry of `GET /search?q=daft punk harder better faster stronger`: no contributors, no release date.
const SEARCH_ENTRY: DeezerTrack = {
    id: 3428967,
    readable: true,
    title: "Harder, Better, Faster, Stronger (Alive Radio Edit 2007)",
    isrc: "GBDUW0700015",
    link: "https://www.deezer.com/track/3428967",
    duration: 204,
    artist: { id: 27, name: "Daft Punk" },
    album: { id: 318470, title: "Harder, Better, Faster, Stronger (Alive Radio Edit 2007)" },
    type: "track",
};

describe("parseDeezerUrl", () => {
    test("reads a track, with or without www, a language and a query", () => {
        for (const url of [
            "https://www.deezer.com/track/3135556",
            "https://deezer.com/track/3135556/",
            "https://www.deezer.com/fr/track/3135556?utm_source=deezer",
            "http://www.deezer.com/pt-br/track/3135556",
        ]) {
            expect(parseDeezerUrl(url)).toEqual({ platform: "deezer", type: "track", id: "3135556" });
        }
    });

    test("albums and playlists are collections; short links are read as tracks to follow", () => {
        expect(parseDeezerUrl("https://www.deezer.com/en/album/302127")).toEqual({
            platform: "deezer",
            type: "album",
            id: "302127",
        });
        expect(parseDeezerUrl("https://www.deezer.com/playlist/908622995")?.type).toBe("playlist");
        expect(parseDeezerUrl("https://link.deezer.com/s/30vkSPj0ZDT")?.id).toBe("link.deezer.com/s/30vkSPj0ZDT");
        expect(parseDeezerUrl("https://deezer.page.link/AbCd")?.id).toBe("deezer.page.link/AbCd");
    });

    test("every other page, site and text is not a Deezer link", () => {
        for (const url of [
            "https://www.deezer.com/artist/27",
            "https://www.deezer.com/fr/",
            "https://www.deezer.com/track/abc",
            "https://www.deezer.com/show/123",
            "https://link.deezer.com/",
            "https://open.spotify.com/track/abc",
            "deezer.com/track/1",
            "not a link",
        ]) {
            expect(parseDeezerUrl(url)).toBeNull();
        }
    });

    test("the desktop app opens tracks, albums and playlists, not short links", () => {
        expect(deezerOpenUri({ platform: "deezer", type: "track", id: "1" })).toBe("deezer://www.deezer.com/track/1");
        expect(deezerOpenUri({ platform: "deezer", type: "track", id: "link.deezer.com/s/x" })).toBeUndefined();
    });
});

describe("convertDeezerToTrack", () => {
    test("maps the full track: title, artists, duration in ms, ISRC, album, canonical url", () => {
        const track = convertDeezerToTrack(slimDeezerTrack(HBFS))!;
        expect(track).toMatchObject({
            id: "3135556",
            trackName: "Harder, Better, Faster, Stronger",
            isrc: "GBDUW0000059",
            duration: 226_000,
            trackNumber: 4,
            url: "https://www.deezer.com/track/3135556",
            uri: "DEEZER::TRACK::3135556",
            platform: "deezer",
            apiProvider: "deezer",
            album: { id: "302127", albumName: "Discovery", releaseDate: "2001-03-07" },
        });
        expect(track.artists.map((a) => a.name)).toEqual(["Daft Punk"]);
        expect(track.bpm).toBeUndefined(); // Deezer's 0 means "unknown"
        expect(track.fetchedBy).toBeUndefined();
    });

    test("a search entry has only its first artist", () => {
        expect(convertDeezerToTrack(SEARCH_ENTRY)?.artists.map((a) => a.name)).toEqual(["Daft Punk"]);
    });

    test("only the main artists are credited, once each", () => {
        const track = convertDeezerToTrack({
            ...HBFS,
            contributors: [
                { id: 1, name: "A", role: "Main" },
                { id: 2, name: "B", role: "Main" },
                { id: 1, name: "A", role: "Main" },
                { id: 3, name: "Featured", role: "Featured" },
            ],
        });
        expect(track?.artists.map((a) => a.name)).toEqual(["A", "B"]);
    });

    test("no id or no title: nothing", () => {
        expect(convertDeezerToTrack({ ...HBFS, id: undefined })).toBeNull();
        expect(convertDeezerToTrack({ ...HBFS, title: " " })).toBeNull();
    });

    test("the cache keeps no preview address or token", () => {
        const slim = slimDeezerTrack(HBFS) as Record<string, unknown>;
        expect(slim.preview).toBeUndefined();
        expect(slim.track_token).toBeUndefined();
    });
});

// The service, with Deezer's API replaced by a fake that answers like the real thing.
const deezerGet = vi.fn();
const followShortLink = vi.fn();
vi.mock("#flows/musicDownloadFlow/services/apis/deezer-client", async (importOriginal) => {
    const real = await importOriginal<typeof import("#flows/musicDownloadFlow/services/apis/deezer-client")>();
    return {
        ...real,
        deezerGet: (path: string, params?: unknown) => deezerGet(path, params),
        followShortLink: (url: string) => followShortLink(url),
    };
});

async function makeService() {
    const { DeezerService } = await import("#flows/musicDownloadFlow/services/metadata-providers/deezer/DeezerService");
    const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
    const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger.createChild = () => logger;
    return new DeezerService({ getStatus: () => status, id: "t" } as never, logger as never);
}

const seed = (trackName: string, artist: string, extra: Partial<TrackMetadata> = {}) =>
    ({
        id: "sp1",
        trackName,
        artists: [{ type: "artist", name: artist }],
        url: "https://open.spotify.com/track/sp1",
        uri: "SPOTIFY::TRACK::sp1",
        platform: "spotify",
        apiProvider: "spotify",
        fetchedAt: new Date(),
        type: "track",
        ...extra,
    }) as unknown as TrackMetadata;

describe("DeezerService", () => {
    beforeEach(async () => {
        deezerGet.mockReset();
        followShortLink.mockReset();
        const { setCacheEnabled } = await import("#utils/cache");
        setCacheEnabled(false);
    });

    test("getTrackMetadata asks the API for the track's id", async () => {
        deezerGet.mockResolvedValue(HBFS);
        const track = await (await makeService()).getTrackMetadata("https://www.deezer.com/fr/track/3135556?utm=x");
        expect(deezerGet).toHaveBeenCalledWith("/track/3135556", undefined);
        expect(track.uri).toBe("DEEZER::TRACK::3135556");
    });

    test("a short link is followed to the track it leads to", async () => {
        followShortLink.mockResolvedValue("https://www.deezer.com/fr/track/3135556?host=1");
        deezerGet.mockResolvedValue(HBFS);
        const track = await (await makeService()).getTrackMetadata("https://link.deezer.com/s/abc");
        expect(followShortLink).toHaveBeenCalledWith("https://link.deezer.com/s/abc");
        expect(track.id).toBe("3135556");
    });

    test("resolveLink follows a short link to the album or playlist it leads to, and leaves other links alone", async () => {
        const { DeezerService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/deezer/DeezerService");
        followShortLink.mockResolvedValue("https://www.deezer.com/fr/album/302127?host=1&utm_campaign=share");
        await expect(DeezerService.resolveLink("https://link.deezer.com/s/30xyz")).resolves.toBe(
            "https://www.deezer.com/album/302127"
        );
        followShortLink.mockResolvedValue("https://www.deezer.com/en/playlist/908622995");
        await expect(DeezerService.resolveLink("https://link.deezer.com/s/40abc")).resolves.toBe(
            "https://www.deezer.com/playlist/908622995"
        );
        // Somewhere Deezer's parser does not read (its home page): the link stays as it was.
        followShortLink.mockResolvedValue("https://www.deezer.com/fr/");
        await expect(DeezerService.resolveLink("https://link.deezer.com/s/gone")).resolves.toBe(
            "https://link.deezer.com/s/gone"
        );
        followShortLink.mockClear();
        expect(DeezerService.resolveLink("https://www.deezer.com/track/3135556")).toBeNull();
        expect(DeezerService.resolveLink("https://open.spotify.com/track/x")).toBeNull();
        // A deezer.page.link host is dead (Firebase Dynamic Links, shut down in 2025): never followed.
        expect(DeezerService.resolveLink("https://deezer.page.link/AbCd")).toBeNull();
        expect(followShortLink).not.toHaveBeenCalled();
    });

    test("a deezer.page.link link fails with the reason, without a request (audit v0.2.4 DEEZER-01)", async () => {
        await expect((await makeService()).getTrackMetadata("https://deezer.page.link/AbCd")).rejects.toThrow(
            /no longer work/
        );
        expect(followShortLink).not.toHaveBeenCalled();
        expect(deezerGet).not.toHaveBeenCalled();
    });

    test("a short link that turns out to be an album says so", async () => {
        followShortLink.mockResolvedValue("https://www.deezer.com/fr/album/302127");
        await expect((await makeService()).getTrackMetadata("https://link.deezer.com/s/abc")).rejects.toThrow(
            /leads to an album/
        );
        expect(deezerGet).not.toHaveBeenCalled();
    });

    test("an album link is not a track", async () => {
        await expect((await makeService()).getTrackMetadata("https://www.deezer.com/album/302127")).rejects.toThrow();
        expect(deezerGet).not.toHaveBeenCalled();
    });

    test("searchTrack finds the recording by ISRC first", async () => {
        deezerGet.mockResolvedValue(HBFS);
        const results = await (
            await makeService()
        ).searchTrack(seed("Harder Better Faster Stronger", "Daft Punk", { isrc: "GBDUW0000059" }));
        expect(deezerGet).toHaveBeenCalledWith("/track/isrc:GBDUW0000059", undefined);
        expect(results).toHaveLength(1);
        expect(results[0].searchKeys).toEqual(["isrc"]);
    });

    test("an unknown ISRC falls back to a name search, gated and best first", async () => {
        const { DeezerApiError } = await import("#flows/musicDownloadFlow/services/apis/deezer-client");
        deezerGet.mockImplementation(async (path: string) => {
            if (path.startsWith("/track/isrc:")) throw new DeezerApiError("no data", 800);
            return {
                data: [
                    { ...SEARCH_ENTRY },
                    { ...HBFS, contributors: undefined },
                    { id: 9, title: "Something Else", artist: { name: "Nobody" }, duration: 100 },
                ],
            };
        });
        const results = await (
            await makeService()
        ).searchTrack(
            seed("Harder, Better, Faster, Stronger", "Daft Punk", { isrc: "XX0000000000", duration: 226_000 })
        );
        expect(results.map((r) => r.metadata.id)).toEqual(["3135556", "3428967"]);
        expect(results[0].searchKeys).toEqual(["trackName+artistName"]);
    });

    test("nothing that looks like the track: an empty answer", async () => {
        deezerGet.mockResolvedValue({ data: [] });
        expect(await (await makeService()).searchTrack(seed("qzxv wplk", "Zzqqxx"))).toEqual([]);
    });

    test("searchTracks returns every readable hit up to the limit", async () => {
        deezerGet.mockResolvedValue({ data: [HBFS, SEARCH_ENTRY, { title: "no id" }] });
        const tracks = await (await makeService()).searchTracks("daft punk", 5);
        expect(tracks.map((t) => t.id)).toEqual(["3135556", "3428967"]);
    });

    test("expandCollection: only 'no data' and permission errors read as a private or deleted list", async () => {
        const { DeezerService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/deezer/DeezerService");
        const { DeezerApiError } = await import("#flows/musicDownloadFlow/services/apis/deezer-client");
        const { CollectionAccessError } = await import("#base/collectionAccessError");
        const expand = () =>
            DeezerService.expandCollection(
                "https://www.deezer.com/playlist/908622995",
                { info: vi.fn() } as never,
                {} as never
            );

        deezerGet.mockRejectedValue(new DeezerApiError("Deezer: no data (/playlist/908622995)", 800));
        await expect(expand()).rejects.toBeInstanceOf(CollectionAccessError);

        deezerGet.mockRejectedValue(new DeezerApiError("Deezer: Quota limit exceeded (/playlist/908622995)", 4));
        const quota = await expand().catch((error: unknown) => error);
        expect(quota).not.toBeInstanceOf(CollectionAccessError);
        expect((quota as Error).message).toMatch(/Quota limit exceeded/);
    });

    test("getAlbumDetails asks for the ISRC of the tracks the album list left without one", async () => {
        deezerGet.mockImplementation(async (path: string) => {
            if (path === "/album/302127") return { id: 302127, title: "Discovery", upc: "724384960650" };
            if (path === "/album/302127/tracks") {
                return {
                    data: [
                        { id: 1, title: "One More Time", isrc: "GBDUW0000053" },
                        { id: 2, title: "Aerodynamic" },
                    ],
                };
            }
            if (path === "/track/2") return { id: 2, title: "Aerodynamic", isrc: "GBDUW0000054" };
            throw new Error(`unexpected ${path}`);
        });
        const album = await (
            await makeService()
        ).getAlbumDetails({ id: "302127", url: "https://www.deezer.com/album/302127" }, { withIsrcs: true });
        expect(album?.tracks.map((t) => t.isrc)).toEqual(["GBDUW0000053", "GBDUW0000054"]);
        expect(deezerGet).not.toHaveBeenCalledWith("/track/1", undefined);
    });

    test("expandCollection lists an album's tracks page after page", async () => {
        const { DeezerService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/deezer/DeezerService");
        deezerGet.mockImplementation(async (path: string, params?: { index: number }) => {
            if (path === "/album/302127") return { id: 302127, title: "Discovery", artist: { name: "Daft Punk" } };
            const index = params?.index ?? 0;
            const count = index === 0 ? 100 : 3;
            return {
                data: Array.from({ length: count }, (_, i) => ({ id: index + i + 1, title: `T${index + i}` })),
                next: index === 0 ? "more" : undefined,
            };
        });
        const logger = { info: vi.fn(), warn: vi.fn() };
        const expansion = await DeezerService.expandCollection(
            "https://www.deezer.com/album/302127",
            logger as never,
            {} as never
        );
        expect(expansion).toMatchObject({ kind: "album", name: "Discovery", ownerName: "Daft Punk", totalCount: 103 });
        expect(expansion.trackUrls[0]).toBe("https://www.deezer.com/track/1");
    });

    test("expandCollection counts the tracks Deezer will not play here instead of losing them silently (DEEZER-02)", async () => {
        const { DeezerService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/deezer/DeezerService");
        deezerGet.mockImplementation(async (path: string) => {
            if (path === "/album/302127") return { id: 302127, title: "Discovery" };
            return {
                data: [
                    { id: 1, title: "A", readable: true },
                    { id: 2, title: "B", readable: false },
                    { id: 3, title: "C", readable: false },
                    { id: 4, title: "D" },
                ],
            };
        });
        const expansion = await DeezerService.expandCollection(
            "https://www.deezer.com/album/302127",
            { info: vi.fn(), warn: vi.fn() } as never,
            {} as never
        );
        expect(expansion).toMatchObject({ totalCount: 2, unavailable: 2 });
    });
});

describe("deezerGet pacing (DEEZER-02)", () => {
    test("a quota refusal (code 4) is waited out and tried again", async () => {
        vi.useFakeTimers();
        const { deezerGet: realGet, resetDeezerPacing } = await vi.importActual<
            typeof import("#flows/musicDownloadFlow/services/apis/deezer-client")
        >("#flows/musicDownloadFlow/services/apis/deezer-client");
        resetDeezerPacing();
        const answers = [{ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }, { id: 7 }];
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(answers.shift())));
        vi.stubGlobal("fetch", fetchMock);
        try {
            const call = realGet<{ id: number }>("/track/7");
            await vi.advanceTimersByTimeAsync(4_000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1_500);
            await expect(call).resolves.toEqual({ id: 7 });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });
});
