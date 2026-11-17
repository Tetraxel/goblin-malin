import { describe, expect, test } from "vitest";
import { YoutubeService } from "#flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService";
import {
    DEFAULT_SEARCH_TIMEOUT_MS,
    MAX_ANNOUNCED_SIZE_BYTES,
    MAX_SEARCH_TIMEOUT_MS,
    MIN_SEARCH_TIMEOUT_MS,
    parseSearchTimeout,
    rankResults,
    soulseekProvenance,
} from "#flows/musicDownloadFlow/services/download-providers/soulseek/ranking";
import { albumArtistsOf, buildFlacTagMap, dateOf, type Metadata } from "#utils/metadata";
import { computeCompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { compiledMetadataToTags } from "#flows/musicDownloadFlow/utils/compiledMetadataToTags";
import type { MetadataGroupState, TrackMetadata } from "#flows/musicDownloadFlow/types";

// Audit v0.2.3, "Downloads", "Soulseek" and "Tags": DL-09, SLSK-03, TAG-04, TAG-05.

describe("DL-09: YouTube link shapes", () => {
    const ID = "dQw4w9WgXcQ";
    const track = (url: string) => YoutubeService.parseUrl(url);

    test("the usual shapes still read", () => {
        expect(track(`https://www.youtube.com/watch?v=${ID}`)).toMatchObject({ type: "track", id: ID });
        expect(track(`https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`)).toMatchObject({ id: ID });
        expect(track(`https://youtu.be/${ID}?si=abc`)).toMatchObject({ id: ID });
        expect(track("https://www.youtube.com/playlist?list=PL123")).toMatchObject({ type: "playlist", id: "PL123" });
    });

    test("Shorts, live pages, embeds and the privacy host name a video too", () => {
        expect(track(`https://www.youtube.com/shorts/${ID}`)).toMatchObject({ type: "track", id: ID });
        expect(track(`https://m.youtube.com/live/${ID}?feature=share`)).toMatchObject({ id: ID });
        expect(track(`https://www.youtube.com/embed/${ID}`)).toMatchObject({ id: ID });
        expect(track(`https://www.youtube-nocookie.com/embed/${ID}`)).toMatchObject({ id: ID });
        expect(track(`https://www.youtube.com/v/${ID}`)).toMatchObject({ id: ID });
    });

    test("an id never contains a slash, and a trailing path is ignored", () => {
        expect(track(`https://youtu.be/${ID}/anything`)).toMatchObject({ id: ID });
        expect(track(`https://www.youtube.com/shorts/${ID}/extra`)).toMatchObject({ id: ID });
    });

    test('an embedded playlist is a playlist, not a track called "videoseries"', () => {
        expect(track("https://www.youtube.com/embed/videoseries?list=PL123")).toMatchObject({
            type: "playlist",
            id: "PL123",
        });
        expect(track("https://www.youtube-nocookie.com/embed/videoseries?list=PL123")).toMatchObject({
            type: "playlist",
            id: "PL123",
        });
        expect(track("https://www.youtube.com/embed/videoseries")).toBeNull();
    });

    test("a link with no usable video id is not a track", () => {
        expect(track("https://www.youtube.com/watch")).toBeNull();
        expect(track("https://www.youtube.com/watch?v=")).toBeNull();
        expect(track("https://www.youtube.com/watch?v=too-short")).toBeNull();
        expect(track("https://youtu.be/")).toBeNull();
        expect(track("https://www.youtube.com/shorts/")).toBeNull();
        expect(track("https://www.youtube.com/@someone")).toBeNull();
        expect(track("https://www.youtube-nocookie.com/watch?v=" + ID)).toBeNull();
    });
});

describe("SLSK-03: Soulseek numbers and labels", () => {
    test("the search timeout is a number between the bounds, else the default", () => {
        expect(parseSearchTimeout("8000")).toBe(8000);
        expect(parseSearchTimeout("1")).toBe(MIN_SEARCH_TIMEOUT_MS);
        expect(parseSearchTimeout("999999999")).toBe(MAX_SEARCH_TIMEOUT_MS);
        expect(parseSearchTimeout("-5")).toBe(DEFAULT_SEARCH_TIMEOUT_MS);
        expect(parseSearchTimeout("soon")).toBe(DEFAULT_SEARCH_TIMEOUT_MS);
        expect(parseSearchTimeout("")).toBe(DEFAULT_SEARCH_TIMEOUT_MS);
        expect(parseSearchTimeout(undefined)).toBe(DEFAULT_SEARCH_TIMEOUT_MS);
    });

    test("a .flac is lossless only if the probe says it is FLAC", () => {
        expect(soulseekProvenance("flac", "flac")).toBe("lossless");
        expect(soulseekProvenance("flac", undefined)).toBe("lossless"); // could not be probed: the extension is all there is
        expect(soulseekProvenance("flac", "mp3")).toBe("lossy");
        expect(soulseekProvenance("flac", "aac")).toBe("lossy");
        expect(soulseekProvenance("mp3", "mp3")).toBe("lossy");
    });

    test("a lossless codec under another name (ALAC, WAV) renamed .flac stays lossless", () => {
        expect(soulseekProvenance("flac", "alac")).toBe("lossless");
        expect(soulseekProvenance("flac", "pcm_s16le")).toBe("lossless");
        expect(soulseekProvenance("flac", "pcm_s24le")).toBe("lossless");
        expect(soulseekProvenance("flac", "opus")).toBe("lossy");
    });

    test("a track announced as hundreds of megabytes is over the limit", () => {
        expect(MAX_ANNOUNCED_SIZE_BYTES).toBe(500 * 1024 * 1024);
    });

    test("an oversized candidate is dropped from the ranking, so it never takes a download attempt", () => {
        const query = { artistName: "Artist", trackTitle: "Title", extension: "flac" as const };
        const normal = {
            user: "u1",
            file: "@@u1\\Artist - Title.flac",
            size: 30 * 1024 * 1024,
            slots: true,
            speed: 500,
        };
        const huge = { ...normal, user: "u2", file: "@@u2\\Artist - Title.flac", size: MAX_ANNOUNCED_SIZE_BYTES + 1 };
        const ranked = rankResults([huge, normal] as never, query);
        expect(ranked.map((result) => result.user)).toEqual(["u1"]);
    });
});

describe("TAG-04: album artists", () => {
    const base: Metadata = { trackTitle: "Song", artists: ["A", "B"] };

    test("an empty list of album artists falls back to the track's artists", () => {
        expect(albumArtistsOf({ ...base, albumArtists: [] })).toEqual(["A", "B"]);
        expect(albumArtistsOf({ ...base, albumArtists: undefined })).toEqual(["A", "B"]);
        expect(albumArtistsOf({ ...base, albumArtists: ["Various Artists"] })).toEqual(["Various Artists"]);
        expect(buildFlacTagMap({ ...base, albumArtists: [] }).ALBUMARTIST).toEqual(["A", "B"]);
    });
});

describe("TAG-05: dates", () => {
    const withDate = (releaseDate: string | undefined): MetadataGroupState[] => [
        {
            platform: "spotify",
            serviceKey: "spotify",
            rank: 0,
            results: [
                {
                    metadata: {
                        id: "1",
                        trackName: "Song",
                        artists: [{ type: "artist", name: "A" }],
                        album: { albumName: "Album", releaseDate },
                        platform: "spotify",
                        apiProvider: "spotify",
                    } as unknown as TrackMetadata,
                    isPrimaryInput: true,
                    isFavorited: false,
                    isRejected: false,
                    rank: 0,
                    discoverySources: [],
                },
            ],
        },
    ];

    test("a full release date is kept next to the year", () => {
        const compiled = computeCompiledMetadata(withDate("2019-05-03"), {});
        expect(compiled.year).toBe(2019);
        expect(compiled.releaseDate).toBe("2019-05-03");
        const tags = compiledMetadataToTags(compiled, { includeMusicBrainzTags: false });
        expect(tags).toMatchObject({ year: "2019", date: "2019-05-03" });
        expect(buildFlacTagMap(tags)).toMatchObject({ YEAR: "2019", DATE: "2019-05-03" });
    });

    test("a source that only knows the year (or the month) gives the year alone", () => {
        for (const date of ["2019", "2019-05"]) {
            const compiled = computeCompiledMetadata(withDate(date), {});
            expect(compiled.year).toBe(2019);
            expect(compiled.releaseDate).toBeUndefined();
            expect(dateOf(compiledMetadataToTags(compiled, { includeMusicBrainzTags: false }))).toBe("2019");
        }
    });

    test("a year typed by the user replaces the date of another year", () => {
        const compiled = computeCompiledMetadata(withDate("2019-05-03"), { year: 2021 });
        expect(compiled.year).toBe(2021);
        expect(compiled.releaseDate).toBeUndefined();
        // The same year typed again keeps the more precise date.
        expect(computeCompiledMetadata(withDate("2019-05-03"), { year: 2019 }).releaseDate).toBe("2019-05-03");
    });
});

describe("TAG-04 / TAG-05: what an MP3 file gets", () => {
    test("the album artist is never empty, and the day and month go in their own frame", async () => {
        const fs = await import("fs");
        const os = await import("os");
        const path = await import("path");
        const NodeId3 = (await import("node-id3")).default;
        const { tagAudioFile } = await import("#flows/musicDownloadFlow/utils/tagAudioFile");

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-mp3-tags-"));
        try {
            const file = path.join(dir, "song.mp3");
            fs.writeFileSync(file, Buffer.alloc(2048));
            await tagAudioFile(file, {
                trackTitle: "Song",
                artists: ["A"],
                albumArtists: [],
                year: "2019",
                date: "2019-05-03",
            });
            const tags = NodeId3.read(file);
            expect(tags.performerInfo).toBe("A");
            expect(tags.year).toBe("2019");
            expect(tags.date).toBe("0305");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
