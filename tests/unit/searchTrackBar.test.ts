import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";
import { YoutubeService } from "#flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService";
import { SpotifyService } from "#flows/musicDownloadFlow/services/metadata-providers/spotify/SpotifyService";
import { setCacheEnabled } from "#utils/cache";

// A platform's search ranks by words, not by what the track is: its first hit can share only a remixer's name with the
// track. `searchTrack` must score the top hits against the track and keep the best one that looks like it, or none.

function fakes() {
    const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
    const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger.createChild = () => logger;
    return { task: { getStatus: () => status, id: "t" } as never, logger: logger as never };
}

const seed = (trackName: string, artist: string, duration: number) =>
    ({
        id: "sc1",
        trackName,
        artists: [{ type: "artist", name: artist }],
        duration,
        url: "https://soundcloud.com/a/b",
        uri: "SOUNDCLOUD::TRACK::a/b",
        platform: "soundcloud",
        apiProvider: "soundcloud",
        fetchedAt: new Date(),
        type: "track",
    }) as unknown as TrackMetadata;

const REFLECTIONS = seed("Reflections (She Said Disco Remix)", "AutoReverse", 348_000);

beforeEach(() => setCacheEnabled(false));

describe("YoutubeService.searchTrack", () => {
    const ytHit = (videoId: string, name: string, artist: string, durationSeconds: number) => ({
        videoId,
        name,
        artist: { artistId: `a-${videoId}`, name: artist },
        duration: durationSeconds,
    });

    function makeYoutube(
        songs: ReturnType<typeof ytHit>[],
        videos: ReturnType<typeof ytHit>[] = [],
        videoSearchFails = false
    ) {
        const getSong = vi.fn(async (videoId: string) => [...songs, ...videos].find((h) => h.videoId === videoId));
        const searchVideos = vi.fn(async () => {
            if (videoSearchFails) throw new Error("boom");
            return videos;
        });
        (YoutubeService as unknown as { client: unknown }).client = {
            searchSongs: async () => songs,
            searchVideos,
            getSong,
        };
        const { task, logger } = fakes();
        return { service: new YoutubeService(task, logger), getSong };
    }

    test("drops a first hit that only shares the remixer's name, and keeps the real track ranked below it", async () => {
        const { service, getSong } = makeYoutube([
            ytHit("wrong", "Danse La France (She Said Disco Remix)", "Ecxellior", 328),
            ytHit("right", "Reflections (She Said Disco Remix)", "AutoReverse", 348),
        ]);
        const results = await service.searchTrack(REFLECTIONS);
        expect(results).toHaveLength(1);
        expect(results[0].metadata.id).toBe("right");
        expect(getSong).toHaveBeenCalledTimes(1);
        expect(getSong).toHaveBeenCalledWith("right");
        // The panel says which hit was kept and why, not "taken as it is".
        const kept = results[0].query?.find((field) => field.label === "Kept")?.value;
        expect(kept).toMatch(/hit 2/);
        expect(kept).toMatch(/at least 50%/);
    });

    test("proposes nothing when no hit looks like the track, and does not fetch any song", async () => {
        const { service, getSong } = makeYoutube([
            ytHit("wrong", "Danse La France (She Said Disco Remix)", "Ecxellior", 328),
            ytHit("other", "Something Else", "Someone", 200),
        ]);
        expect(await service.searchTrack(REFLECTIONS)).toEqual([]);
        expect(getSong).not.toHaveBeenCalled();
    });

    // Your case: the track is only on YouTube as someone's upload, named "Artist - Title" and credited to the channel.
    const UPLOAD = (id: string, channel = "DiscoFactory", seconds = 348) =>
        ytHit(id, "AutoReverse - Reflections (She Said Disco Remix)", channel, seconds);

    test("finds a video upload when no song is the track, reading artist and title out of the video's title", async () => {
        const { service, getSong } = makeYoutube(
            [ytHit("wrong", "Danse La France (She Said Disco Remix)", "Ecxellior", 328)],
            [UPLOAD("up1")]
        );
        const results = await service.searchTrack(REFLECTIONS);
        expect(results).toHaveLength(1);
        const [video] = results;
        expect(video.metadata.id).toBe("up1");
        expect(video.metadata.isUpload).toBe(true);
        expect(video.metadata.url).toBe("https://www.youtube.com/watch?v=up1");
        expect(video.metadata.trackName).toBe("Reflections (She Said Disco Remix)");
        expect(video.metadata.artists.map((a) => a.name)).toEqual(["AutoReverse"]);
        expect(video.query?.find((f) => f.label === "Kept")?.value).toMatch(/video upload by "DiscoFactory"/);
        // A video's search result already says everything: no extra song lookup.
        expect(getSong).not.toHaveBeenCalled();
    });

    test("lists the songs before the videos, at most two videos, and not the video that is the song", async () => {
        const { service } = makeYoutube(
            [ytHit("song", "Reflections (She Said Disco Remix)", "AutoReverse", 348)],
            [UPLOAD("song"), UPLOAD("up1"), UPLOAD("up2", "TheDjJade"), UPLOAD("up3", "St BRENNER")]
        );
        const results = await service.searchTrack(REFLECTIONS);
        expect(results.map((r) => r.metadata.id)).toEqual(["song", "up1", "up2"]);
        expect(results.map((r) => r.metadata.isUpload ?? false)).toEqual([false, true, true]);
    });

    test("ignores uploads of another version or another song", async () => {
        const { service } = makeYoutube(
            [],
            [
                ytHit("orig", "AutoReverse - Reflections", "Miraje Musique", 357),
                ytHit("other", "Autoreverse - Reflections (Pakem Remix)", "Soak That Vibe", 297),
                ytHit("live", "Reflections (She Said Disco Remix) live cover", "Someone", 348),
            ]
        );
        expect(await service.searchTrack(REFLECTIONS)).toEqual([]);
    });

    test("a failing video search does not lose the songs", async () => {
        const { service } = makeYoutube(
            [ytHit("song", "Reflections (She Said Disco Remix)", "AutoReverse", 348)],
            [],
            true
        );
        const results = await service.searchTrack(REFLECTIONS);
        expect(results.map((r) => r.metadata.id)).toEqual(["song"]);
    });

    test("the chat's catalogue search lists songs, then marked video uploads, without repeating a song", async () => {
        const { service } = makeYoutube(
            [ytHit("s1", "Reflections", "Paradisco", 353), ytHit("s2", "Reflections", "Disco's Over", 337)],
            [UPLOAD("s1"), UPLOAD("up1"), UPLOAD("up2"), UPLOAD("up3")]
        );
        const found = await service.searchTracks("Reflections She Said Disco Remix", 4);
        expect(found.map((t) => t.id)).toEqual(["s1", "s2", "up1", "up2"]);
        expect(found.map((t) => t.isUpload ?? false)).toEqual([false, false, true, true]);
        // The upload is read like a discovery one: the artist is the one in the title, not the channel.
        expect(found[2].artists.map((a) => a.name)).toEqual(["AutoReverse"]);
    });

    test("the chat's search still answers with the songs when the video search fails", async () => {
        const { service } = makeYoutube([ytHit("s1", "Reflections", "Paradisco", 353)], [], true);
        expect((await service.searchTracks("Reflections", 4)).map((t) => t.id)).toEqual(["s1"]);
    });

    test("strips '(Official Video)' noise and keeps the channel as artist when the title has no artist", async () => {
        const seedTrack = seed("Latch", "Disclosure", 255_000);
        const { service } = makeYoutube([], [ytHit("v", "Latch (Official Video)", "Disclosure", 255)]);
        const [video] = await service.searchTrack(seedTrack);
        expect(video.metadata.trackName).toBe("Latch");
        expect(video.metadata.artists.map((a) => a.name)).toEqual(["Disclosure"]);
    });
});

describe("SpotifyService.searchTrack", () => {
    const spHit = (id: string, name: string, artist: string, durationMs: number) => ({
        id,
        name,
        duration_ms: durationMs,
        external_urls: { spotify: `https://open.spotify.com/track/${id}` },
        artists: [{ id: `a-${id}`, name: artist, external_urls: { spotify: "" } }],
        album: { id: "al", name: "Album", release_date: "2020-01-01", images: [], artists: [], external_urls: {} },
        external_ids: {},
        track_number: 1,
    });

    function makeSpotify(items: ReturnType<typeof spHit>[]) {
        const search = vi.fn(async () => ({ tracks: { items } }));
        const { task, logger } = fakes();
        const service = new SpotifyService(task, logger);
        const internals = service as unknown as Record<string, unknown>;
        internals.resolveAuth = async () => undefined;
        internals.getClient = async () => ({ search });
        (SpotifyService as unknown as { authMode: string }).authMode = "official";
        return { service, search };
    }

    test("keeps the best of the top hits, not the first", async () => {
        const { service, search } = makeSpotify([
            spHit("wrong", "Danse La France (She Said Disco Remix)", "Ecxellior", 328_000),
            spHit("right", "Reflections (She Said Disco Remix)", "AutoReverse", 348_000),
        ]);
        const results = await service.searchTrack(REFLECTIONS);
        expect(results.map((r) => r.metadata.id)).toEqual(["right"]);
        // More than one hit is asked for, or there would be nothing to choose from.
        expect((search.mock.calls[0] as unknown[])[3]).toBeGreaterThan(1);
    });

    test("proposes nothing when no hit looks like the track", async () => {
        const { service } = makeSpotify([
            spHit("wrong", "Danse La France (She Said Disco Remix)", "Ecxellior", 328_000),
        ]);
        expect(await service.searchTrack(REFLECTIONS)).toEqual([]);
    });
});
