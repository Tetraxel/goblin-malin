import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    parseSoundCloudUrl,
    soundcloudPlaylistUrl,
    soundcloudTrackUrl,
} from "#flows/musicDownloadFlow/services/metadata-providers/soundcloud/soundcloudUrl";
import {
    convertSoundCloudToTrack,
    slimSoundCloudInfo,
    type SoundCloudInfo,
} from "#flows/musicDownloadFlow/services/metadata-providers/soundcloud/convertSoundCloudToTrack";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";
import { findExistingTempFile, generateTempStem } from "#flows/musicDownloadFlow/utils/tempFile";
import { ServiceRegistry } from "#base/service-registry";
import { platformRegistry } from "#base/platformRegistry";

// What yt-dlp really printed for `scsearch1:flume never be like you` (trimmed to the fields the app reads).
const FLUME: SoundCloudInfo = {
    id: "242136202",
    title: "Never Be Like You feat. Kai",
    track: "Never Be Like You feat. Kai",
    uploader: "Flume",
    uploader_id: "2976616",
    uploader_url: "https://soundcloud.com/flume",
    duration: 235.017,
    webpage_url: "https://soundcloud.com/flume/never-be-like-you-feat-kai",
    genres: ["SKIN"],
};

describe("parseSoundCloudUrl", () => {
    test("reads a track and uses its permalink as the id", () => {
        expect(parseSoundCloudUrl("https://soundcloud.com/flume/never-be-like-you-feat-kai")).toEqual({
            platform: "soundcloud",
            type: "track",
            id: "flume/never-be-like-you-feat-kai",
        });
    });

    test("ignores www, the mobile host, a trailing slash and the query", () => {
        for (const url of [
            "https://www.soundcloud.com/flume/never-be-like-you-feat-kai",
            "https://m.soundcloud.com/flume/never-be-like-you-feat-kai/",
            "http://soundcloud.com/flume/never-be-like-you-feat-kai?in=flume/sets/skin&utm_source=clipboard",
        ]) {
            expect(parseSoundCloudUrl(url)?.id).toBe("flume/never-be-like-you-feat-kai");
        }
    });

    test("one track has one id whatever the casing of its link; tokens and short codes keep theirs", () => {
        expect(parseSoundCloudUrl("https://soundcloud.com/Flume/Never-Be-Like-You-feat-Kai")?.id).toBe(
            "flume/never-be-like-you-feat-kai"
        );
        expect(parseSoundCloudUrl("https://soundcloud.com/Flume/Unreleased/s-AbC123xyz")?.id).toBe(
            "flume/unreleased/s-AbC123xyz"
        );
        expect(parseSoundCloudUrl("https://on.soundcloud.com/AbCdEf")?.id).toBe("on.soundcloud.com/AbCdEf");
    });

    test("keeps the secret token of a private track", () => {
        expect(parseSoundCloudUrl("https://soundcloud.com/flume/unreleased/s-AbC123xyz")?.id).toBe(
            "flume/unreleased/s-AbC123xyz"
        );
        expect(parseSoundCloudUrl("https://soundcloud.com/flume/unreleased/comments")).toBeNull();
    });

    test("reads a short link without resolving it", () => {
        expect(parseSoundCloudUrl("https://on.soundcloud.com/AbCdEf")).toEqual({
            platform: "soundcloud",
            type: "track",
            id: "on.soundcloud.com/AbCdEf",
        });
        expect(parseSoundCloudUrl("https://on.soundcloud.com/")).toBeNull();
    });

    test("reads a playlist or album (a set), with its secret token when it is private", () => {
        expect(parseSoundCloudUrl("https://soundcloud.com/flume/sets/skin")).toEqual({
            platform: "soundcloud",
            type: "playlist",
            id: "flume/sets/skin",
        });
        // The casing of the permalink does not matter, the query and the mobile host neither; a token keeps its case.
        expect(parseSoundCloudUrl("https://m.soundcloud.com/Flume/sets/SKIN/?utm_source=clipboard")?.id).toBe(
            "flume/sets/skin"
        );
        expect(parseSoundCloudUrl("https://soundcloud.com/flume/sets/skin/s-AbC123xyz")?.id).toBe(
            "flume/sets/skin/s-AbC123xyz"
        );
        expect(soundcloudPlaylistUrl("flume/sets/skin/s-AbC123xyz")).toBe(
            "https://soundcloud.com/flume/sets/skin/s-AbC123xyz"
        );
        // A page under the set is not the set.
        expect(parseSoundCloudUrl("https://soundcloud.com/flume/sets/skin/comments")).toBeNull();
        expect(parseSoundCloudUrl("https://soundcloud.com/flume/sets/skin/s-AbC/extra")).toBeNull();
    });

    test("does not take profiles and site pages for tracks or playlists", () => {
        for (const url of [
            "https://soundcloud.com/flume/sets",
            "https://soundcloud.com/flume",
            "https://soundcloud.com/flume/tracks",
            "https://soundcloud.com/flume/likes",
            "https://soundcloud.com/discover/sets/charts-top:all-music",
            "https://soundcloud.com/charts/top",
            "https://soundcloud.com/",
        ]) {
            expect(parseSoundCloudUrl(url), url).toBeNull();
        }
    });

    test("does not take other sites or non-links", () => {
        expect(parseSoundCloudUrl("https://example.com/flume/never-be-like-you")).toBeNull();
        expect(parseSoundCloudUrl("https://notsoundcloud.com/flume/song")).toBeNull();
        expect(parseSoundCloudUrl("ftp://soundcloud.com/flume/song")).toBeNull();
        expect(parseSoundCloudUrl("not a url")).toBeNull();
    });

    test("an id builds back the page it came from", () => {
        expect(soundcloudTrackUrl("flume/never-be-like-you-feat-kai")).toBe(
            "https://soundcloud.com/flume/never-be-like-you-feat-kai"
        );
        expect(soundcloudTrackUrl("on.soundcloud.com/AbCdEf")).toBe("https://on.soundcloud.com/AbCdEf");
    });
});

describe("convertSoundCloudToTrack", () => {
    test("maps what yt-dlp printed", () => {
        const track = convertSoundCloudToTrack(FLUME)!;
        expect(track).toMatchObject({
            id: "flume/never-be-like-you-feat-kai",
            uri: "SOUNDCLOUD::TRACK::flume/never-be-like-you-feat-kai",
            trackName: "Never Be Like You feat. Kai",
            duration: 235017,
            url: "https://soundcloud.com/flume/never-be-like-you-feat-kai",
            platform: "soundcloud",
            apiProvider: "soundcloud",
            type: "track",
            genres: ["SKIN"],
        });
        expect(track.artists).toEqual([
            {
                type: "artist",
                id: "2976616",
                name: "Flume",
                url: "https://soundcloud.com/flume",
                uri: "soundcloud:user:2976616",
            },
        ]);
    });

    test("never uses the API address in `url`: the page is webpage_url, without the query", () => {
        const track = convertSoundCloudToTrack({
            ...FLUME,
            webpage_url: "https://soundcloud.com/flume/never-be-like-you-feat-kai?in=flume/sets/skin",
        })!;
        expect(track.url).toBe("https://soundcloud.com/flume/never-be-like-you-feat-kai");
    });

    test('takes the artist out of an "Artist - Title" upload, whoever uploaded it', () => {
        const track = convertSoundCloudToTrack({
            ...FLUME,
            title: "Disclosure - Latch (Flume Remix)",
            track: undefined,
            uploader: "Some Label",
            webpage_url: "https://soundcloud.com/somelabel/latch-flume-remix",
        })!;
        expect(track.trackName).toBe("Latch (Flume Remix)");
        expect(track.artists.map((a) => a.name)).toEqual(["Disclosure"]);
    });

    test("trusts a declared artist over a guess from the title", () => {
        const track = convertSoundCloudToTrack({
            ...FLUME,
            title: "Part 1 - Intro",
            track: "Part 1 - Intro",
            artists: ["Flume", "Kai"],
        })!;
        expect(track.trackName).toBe("Part 1 - Intro");
        expect(track.artists.map((a) => a.name)).toEqual(["Flume", "Kai"]);
    });

    test("a credited name with a comma in it stays whole", () => {
        const fromList = convertSoundCloudToTrack({ ...FLUME, artists: ["Tyler, The Creator", "Earth, Wind & Fire"] })!;
        expect(fromList.artists.map((a) => a.name)).toEqual(["Tyler, The Creator", "Earth, Wind & Fire"]);
        // The single text is only split on `;`.
        const fromText = convertSoundCloudToTrack({ ...FLUME, artist: "Tyler, The Creator" })!;
        expect(fromText.artists.map((a) => a.name)).toEqual(["Tyler, The Creator"]);
        const several = convertSoundCloudToTrack({ ...FLUME, artist: "Flume; Kai" })!;
        expect(several.artists.map((a) => a.name)).toEqual(["Flume", "Kai"]);
    });

    test("a dash that names a version is not an artist separator", () => {
        const names = (title: string, uploader = "Flume") => {
            const t = convertSoundCloudToTrack({ ...FLUME, title, track: undefined, uploader })!;
            return [t.artists.map((a) => a.name)[0], t.trackName];
        };
        expect(names("Never Be Like You - Flume Remix")).toEqual(["Flume", "Never Be Like You - Flume Remix"]);
        expect(names("Song - Slowed")).toEqual(["Flume", "Song - Slowed"]);
        expect(names("Song - Slowed + Reverb")).toEqual(["Flume", "Song - Slowed + Reverb"]);
        // An upload by the name before the dash is "Artist - Title" even when the title looks like a version.
        expect(names("Flume - Live")).toEqual(["Flume", "Live"]);
        // A title that merely contains a version word is still "Artist - Title".
        expect(names("Oasis - Live Forever", "Some Label")).toEqual(["Oasis", "Live Forever"]);
        expect(names("Disclosure - Latch (Flume Remix)", "Some Label")).toEqual(["Disclosure", "Latch (Flume Remix)"]);
    });

    test("a hyphen inside a word is not a separator", () => {
        const track = convertSoundCloudToTrack({ ...FLUME, title: "Never-Be-Like-You", track: undefined })!;
        expect(track.trackName).toBe("Never-Be-Like-You");
        expect(track.artists[0].name).toBe("Flume");
    });

    test("is null without a title or a readable page", () => {
        expect(convertSoundCloudToTrack({ ...FLUME, title: "", track: "" })).toBeNull();
        expect(convertSoundCloudToTrack({ ...FLUME, webpage_url: undefined })).toBeNull();
        // A page that is not a track (the playlist a short link led to).
        expect(
            convertSoundCloudToTrack({ ...FLUME, webpage_url: "https://soundcloud.com/flume/sets/skin" })
        ).toBeNull();
    });

    test("leaves out what SoundCloud did not say", () => {
        const track = convertSoundCloudToTrack({ title: "Song", webpage_url: "https://soundcloud.com/a/song" })!;
        expect(track.duration).toBeUndefined();
        expect(track.genres).toBeUndefined();
        expect(track.artists).toEqual([]);
    });

    test("slimming keeps only what the mapping reads", () => {
        const heavy = { ...FLUME, description: "x".repeat(5000), formats: [{}, {}] } as SoundCloudInfo;
        const slim = slimSoundCloudInfo(heavy);
        expect(Object.keys(slim)).not.toContain("description");
        expect(Object.keys(slim)).not.toContain("formats");
        expect(convertSoundCloudToTrack(slim)).toMatchObject({ trackName: FLUME.title });
    });
});

// The service itself, with yt-dlp replaced by a fake that answers like the real thing.
const getInfoAsync = vi.fn();
const ytdlp = { enabled: true };
vi.mock("#flows/musicDownloadFlow/services/apis/ytdlp-client", () => ({
    readYtDlpInfo: async (url: string) => getInfoAsync(url),
    isYtDlpEnabled: () => ytdlp.enabled,
}));

type Service =
    import("#flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService").SoundCloudService;

async function makeService(): Promise<Service> {
    const { SoundCloudService } =
        await import("#flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService");
    const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
    const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger.createChild = () => logger;
    const task = { getStatus: () => status, id: "t" };
    return new SoundCloudService(task as never, logger as never);
}

const seed = (trackName: string, artist: string, duration?: number) =>
    ({
        id: "sp1",
        trackName,
        artists: [{ type: "artist", name: artist }],
        duration,
        url: "https://open.spotify.com/track/sp1",
        uri: "SPOTIFY::TRACK::sp1",
        platform: "spotify",
        apiProvider: "spotify",
        fetchedAt: new Date(),
        type: "track",
    }) as unknown as TrackMetadata;

const entry = (title: string, uploader: string, slug: string, duration: number): SoundCloudInfo => ({
    id: slug,
    title,
    track: title,
    uploader,
    duration,
    webpage_url: `https://soundcloud.com/${slug}`,
});

describe("SoundCloudService", () => {
    beforeEach(async () => {
        getInfoAsync.mockReset();
        ytdlp.enabled = true;
        // Nothing in these tests may be answered from (or written to) the app's disk cache.
        const { setCacheEnabled } = await import("#utils/cache");
        setCacheEnabled(false);
    });

    test("getTrackMetadata reads the track's page through yt-dlp", async () => {
        getInfoAsync.mockResolvedValue({ ...FLUME, description: "long", _type: "video" });
        const service = await makeService();
        const track = await service.getTrackMetadata("https://soundcloud.com/flume/never-be-like-you-feat-kai?in=x");
        expect(getInfoAsync).toHaveBeenCalledWith("https://soundcloud.com/flume/never-be-like-you-feat-kai");
        expect(track.uri).toBe("SOUNDCLOUD::TRACK::flume/never-be-like-you-feat-kai");
        expect(track.apiProvider).toBe("soundcloud");
    });

    test("getTrackMetadata keeps the id the link was read as, even when SoundCloud's page differs", async () => {
        getInfoAsync.mockResolvedValue({ ...FLUME, _type: "video" });
        const service = await makeService();
        const short = await service.getTrackMetadata("https://on.soundcloud.com/AbCdEf");
        expect(short.id).toBe("on.soundcloud.com/AbCdEf");
        expect(short.uri).toBe("SOUNDCLOUD::TRACK::on.soundcloud.com/AbCdEf");
        // The page to open and download is still the permalink.
        expect(short.url).toBe("https://soundcloud.com/flume/never-be-like-you-feat-kai");

        // A renamed permalink: SoundCloud answers with the new page, the track stays under the pasted link's id.
        const renamed = await service.getTrackMetadata("https://soundcloud.com/flume/old-name");
        expect(renamed.uri).toBe("SOUNDCLOUD::TRACK::flume/old-name");
    });

    test("getTrackMetadata refuses a link that is not a track, and a short link that leads to a playlist", async () => {
        const service = await makeService();
        await expect(service.getTrackMetadata("https://soundcloud.com/flume/sets/skin")).rejects.toThrow(/Invalid/);
        getInfoAsync.mockResolvedValue({ _type: "playlist", entries: [] });
        await expect(service.getTrackMetadata("https://on.soundcloud.com/AbCdEf")).rejects.toThrow(
            /Not a SoundCloud track/
        );
    });

    test("searchTrack proposes only uploads that look like the track, best first", async () => {
        getInfoAsync.mockResolvedValue({
            entries: [
                entry("Never Be Like You (Slowed + Reverb)", "slowed edits", "slowed/nbly", 300),
                entry("Never Be Like You feat. Kai", "Flume", "flume/never-be-like-you-feat-kai", 235),
                entry("Totally unrelated", "Someone", "someone/unrelated", 100),
                entry("Flume - Never Be Like You (feat. Kai)", "Repost Channel", "repost/nbly", 236),
            ],
        });
        const service = await makeService();
        const results = await service.searchTrack(seed("Never Be Like You", "Flume", 234_000));

        expect(getInfoAsync).toHaveBeenCalledWith(expect.stringMatching(/^scsearch\d+:Flume Never Be Like You$/));
        const ids = results.map((r) => r.metadata.id);
        expect(ids[0]).toBe("flume/never-be-like-you-feat-kai");
        expect(ids).not.toContain("someone/unrelated");
        expect(ids).not.toContain("slowed/nbly");
        for (const r of results) expect(r.searchKeys).toEqual(["trackName+artistName"]);
        // What SoundCloud was asked, and how much of the answer was kept, goes with every result.
        const search = results[0].query?.find((f) => f.label === "Search")?.value;
        expect(search).toMatch(/^scsearch\d+:Flume Never Be Like You$/);
        expect(results[0].query?.find((f) => f.label === "Kept")?.value).toMatch(/^\d+ of 4 result\(s\)/);
    });

    test("searchTrack with nothing convincing proposes nothing (it is not an error)", async () => {
        getInfoAsync.mockResolvedValue({ entries: [entry("Totally unrelated", "Someone", "someone/unrelated", 100)] });
        const service = await makeService();
        expect(await service.searchTrack(seed("Never Be Like You", "Flume"))).toEqual([]);
    });

    test("searchTrack does not start yt-dlp when the yt-dlp provider is switched off", async () => {
        ytdlp.enabled = false;
        const service = await makeService();
        expect(await service.searchTrack(seed("Never Be Like You", "Flume"))).toEqual([]);
        expect(getInfoAsync).not.toHaveBeenCalled();
    });

    test("searchTrack needs an artist and a title", async () => {
        const service = await makeService();
        await expect(service.searchTrack(seed("Never Be Like You", ""))).rejects.toThrow(/required/);
    });

    test("searchTracks (the chat's search) returns every readable hit, unfiltered, up to the limit", async () => {
        getInfoAsync.mockResolvedValue({
            entries: [
                entry("A", "x", "x/a", 10),
                { title: "no page" },
                entry("B", "y", "y/b", 20),
                entry("C", "z", "z/c", 30),
            ],
        });
        const service = await makeService();
        const results = await service.searchTracks("anything", 2);
        expect(getInfoAsync).toHaveBeenCalledWith("scsearch2:anything");
        expect(results.map((r) => r.trackName)).toEqual(["A", "B"]);
    });
});

describe("SoundCloudService.expandCollection (playlists and albums)", () => {
    const logger = () => {
        const log: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        log.createChild = () => log;
        return log as never;
    };
    const expand = async (url: string) => {
        const { SoundCloudService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService");
        return SoundCloudService.expandCollection(url, logger(), {} as never);
    };
    // What yt-dlp really printed for `soundcloud.com/flume/sets/skin` with --flat-playlist (trimmed).
    const SET = {
        _type: "playlist",
        title: "SKIN",
        uploader: "Flume",
        album_type: "album",
        entries: [
            { _type: "url_transparent", url: "https://soundcloud.com/flume/never-be-like-you-feat-kai" },
            { _type: "url_transparent", url: "https://soundcloud.com/flume/flume-lose-it-feat-vic-mensa" },
        ],
    };

    beforeEach(() => {
        getInfoAsync.mockReset();
    });

    test("lists the set's tracks as canonical track links, with its name and owner", async () => {
        getInfoAsync.mockResolvedValue(SET);
        const expansion = await expand("https://soundcloud.com/Flume/sets/SKIN?utm_source=clipboard");

        expect(getInfoAsync).toHaveBeenCalledWith("https://soundcloud.com/flume/sets/skin");
        expect(expansion).toEqual({
            kind: "album",
            name: "SKIN",
            ownerName: "Flume",
            totalCount: 2,
            trackUrls: [
                "https://soundcloud.com/flume/never-be-like-you-feat-kai",
                "https://soundcloud.com/flume/flume-lose-it-feat-vic-mensa",
            ],
        });
    });

    test("a plain playlist is a playlist; a track listed twice, or an entry that is not a track page, is left out", async () => {
        getInfoAsync.mockResolvedValue({
            title: "  mix  ",
            uploader: "someone",
            entries: [
                { url: "https://soundcloud.com/a/one" },
                { url: "https://soundcloud.com/A/One?in=x" },
                { url: "https://api-v2.soundcloud.com/tracks/123" },
                { url: "https://soundcloud.com/b/sets/other" },
                {},
            ],
        });
        const expansion = await expand("https://soundcloud.com/someone/sets/mix");
        expect(expansion.kind).toBe("playlist");
        expect(expansion.name).toBe("mix");
        expect(expansion.trackUrls).toEqual(["https://soundcloud.com/a/one"]);
        expect(expansion.totalCount).toBe(1);
    });

    test("a set that SoundCloud will not show says what to do, as a collection access error", async () => {
        getInfoAsync.mockRejectedValue(new Error("Unable to download JSON metadata: HTTP Error 404: Not Found"));
        const { CollectionAccessError } = await import("#base/collectionAccessError");
        await expect(expand("https://soundcloud.com/flume/sets/gone")).rejects.toBeInstanceOf(CollectionAccessError);

        // Any other failure (offline, a timeout) is not blamed on the playlist.
        getInfoAsync.mockRejectedValue(new Error("SoundCloud took too long to answer"));
        await expect(expand("https://soundcloud.com/flume/sets/skin")).rejects.toThrow(/too long/);
    });

    test("refuses a link that is not a playlist", async () => {
        await expect(expand("https://soundcloud.com/flume/never-be-like-you-feat-kai")).rejects.toThrow(
            /Not a SoundCloud playlist/
        );
    });

    test("importing the link makes a playlist collection recognised by SoundCloud, not a track", async () => {
        const { SoundCloudService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService");
        const { resolveCollectionRecognition } =
            await import("#flows/musicDownloadFlow/utils/resolveCollectionRecognition");
        const { resolveTrackRecognition } = await import("#flows/musicDownloadFlow/utils/resolveTrackRecognition");
        const registry = new ServiceRegistry();
        registry.register("soundcloud", SoundCloudService as never);

        const url = "https://soundcloud.com/flume/sets/skin";
        expect(resolveCollectionRecognition(url, registry as never)).toEqual({
            serviceKey: "soundcloud",
            collectionKind: "playlist",
            sourceId: "flume/sets/skin",
        });
        expect(resolveTrackRecognition(url, registry as never)).toBeNull();
    });
});

describe("yt-dlp downloads what SoundCloud finds", () => {
    test("a SoundCloud track is a source yt-dlp accepts, and Spotify's is not", async () => {
        const { YtDlpService } =
            await import("#flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService");
        const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
        const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
        logger.createChild = () => logger;
        const ytdlp = new YtDlpService({ getStatus: () => status, id: "t" } as never, logger as never);

        expect(ytdlp.canDownload(convertSoundCloudToTrack(FLUME)!)).toBe(true);
        expect(ytdlp.canDownload(seed("Never Be Like You", "Flume"))).toBe(false);
    });
});

describe("a SoundCloud track in a temp file name", () => {
    const soundcloud = () => convertSoundCloudToTrack(FLUME)!;

    test("the id's slash does not become a folder", () => {
        for (const track of [soundcloud(), { ...soundcloud(), uri: "SOUNDCLOUD::TRACK::on.soundcloud.com/AbCdEf" }]) {
            const stem = generateTempStem("YtDlp", track as TrackMetadata);
            expect(stem).not.toMatch(/[\\/]/);
            expect(stem.startsWith("YtDlp SOUNDCLOUD-TRACK-")).toBe(true);
        }
    });

    test("a finished download of it is found again, so it is not downloaded twice", async () => {
        const dir = await mkdtemp(join(tmpdir(), "gm-soundcloud-"));
        try {
            const track = soundcloud();
            expect(await findExistingTempFile("YtDlp", track, ["flac", "opus"], dir)).toBeUndefined();
            const file = `${generateTempStem("YtDlp", track)}.opus`;
            await writeFile(join(dir, file), "x");
            expect(await findExistingTempFile("YtDlp", track, ["flac", "opus"], dir)).toBe(join(dir, file));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe("the codec a platform serves", () => {
    test("YouTube declares Opus (and so does YouTube Music), SoundCloud declares none", async () => {
        const { YoutubeService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService");
        const { SoundCloudService } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService");
        const registry = new ServiceRegistry();
        registry.register("youtube", YoutubeService as never);
        registry.register("soundcloud", SoundCloudService as never);

        expect(platformRegistry.upstreamCodec("youtube")).toBe("Opus");
        expect(platformRegistry.upstreamCodec("youtubeMusic")).toBe("Opus");
        expect(platformRegistry.upstreamCodec("soundcloud")).toBeUndefined();
    });
});
