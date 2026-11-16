import { describe, test, expect } from "vitest";
import { FileAttribute, type SearchResult } from "slsk-client";
import {
    cleanSearchTerm,
    relaxedTitle,
    calculateResultWeight,
    rankResults,
    parseResultsLimit,
    remoteFileName,
    DEFAULT_RESULTS_LIMIT,
    MAX_DOWNLOAD_ATTEMPTS,
    MAX_HIDDEN_RESULTS,
    announcedAudio,
} from "#flows/musicDownloadFlow/services/download-providers/soulseek/ranking";
import { formatAnnouncedAudio } from "#components/SecondaryPanel/DownloadPanel/utils";

/** A search result; `bitrate` (kbps) lands in `attribs`, where slsk-client reports it. */
function file({ bitrate = 1000, ...overrides }: Partial<SearchResult> & { bitrate?: number } = {}): SearchResult {
    return {
        user: "someuser",
        file: "@@someuser\\Music\\Artist - Title.flac",
        size: 30 * 1024 * 1024,
        slots: true,
        attribs: { [FileAttribute.Bitrate]: bitrate },
        speed: 500,
        ...overrides,
    };
}

describe("cleanSearchTerm", () => {
    test("strips characters that confuse Soulseek search matching", () => {
        expect(cleanSearchTerm('Artist: "Title" (feat. X)/Y')).toBe("Artist Title feat. X Y");
    });

    test("collapses repeated whitespace and trims", () => {
        expect(cleanSearchTerm("  Artist   Title  ")).toBe("Artist Title");
    });

    test("returns empty string for undefined input", () => {
        expect(cleanSearchTerm(undefined)).toBe("");
    });

    test("no word starts with '-' (that excludes the word from a Soulseek search)", () => {
        expect(cleanSearchTerm("Artist - Title .flac")).toBe("Artist Title .flac");
        expect(cleanSearchTerm("Artist -Title")).toBe("Artist Title");
        expect(cleanSearchTerm("Jay-Z Song")).toBe("Jay-Z Song");
    });
});

describe("relaxedTitle", () => {
    test.each([
        ["Song - 2011 Remaster", "Song"],
        ["Song (feat. Other Artist)", "Song"],
        ["Song - Radio Edit", "Song"],
        ["Song (Remastered 2009) [Bonus Track]", "Song"],
        ["Song feat. Someone", "Song"],
        ["Song ft. Someone", "Song"],
        ["Plain Song", "Plain Song"],
    ])("%j is searched as %j", (title, expected) => {
        expect(relaxedTitle(title)).toBe(expected);
    });

    test("a part that names another version stays", () => {
        expect(relaxedTitle("Song (Club Remix)")).toBe("Song (Club Remix)");
        expect(relaxedTitle("Song - Live at Wembley")).toBe("Song - Live at Wembley");
        expect(relaxedTitle("Song (feat. X) (Instrumental)")).toBe("Song (Instrumental)");
    });

    test("never ends up empty", () => {
        expect(relaxedTitle("(Intro)")).toBe("(Intro)");
    });
});

describe("calculateResultWeight", () => {
    const query = { artistName: "Artist", trackTitle: "Title", albumName: "Album", extension: "flac" };

    test("disqualifies a result with the wrong extension", () => {
        expect(calculateResultWeight(file({ file: "@@u\\Title.mp3" }), query)).toBe(-1);
    });

    test("keeps a result with no free slots (it ranks after the free-slot ones, see rankResults)", () => {
        expect(calculateResultWeight(file({ slots: false }), query)).toBeGreaterThan(0);
    });

    test("disqualifies a remix result when a non-remix track was requested", () => {
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Title (Remix).flac" }), query)).toBe(-1);
    });

    test("disqualifies a non-remix result when a remix track was requested", () => {
        const remixQuery = { ...query, trackTitle: "Title (Remix)" };
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Title.flac" }), remixQuery)).toBe(-1);
    });

    test("parses Soulseek's backslash-separated paths regardless of host OS", () => {
        // path.win32 must be used explicitly — the platform-default `path` module
        // would mis-split this on macOS/Linux and silently miss the extension.
        const result = calculateResultWeight(file({ file: "@@u\\Deep\\Folder\\Artist - Title.flac" }), query);
        expect(result).toBeGreaterThan(0);
    });

    test("scores a higher-bitrate result higher, all else equal", () => {
        const low = calculateResultWeight(file({ bitrate: 320 }), query);
        const high = calculateResultWeight(file({ bitrate: 1400 }), query);
        expect(high).toBeGreaterThan(low);
    });

    test("gives a bonus to extended-mix filenames when the title asks for the extended mix", () => {
        const wanted = { ...query, trackTitle: "Title (Extended Mix)" };
        const plainFile = calculateResultWeight(file({ file: "@@u\\Artist - Title.flac" }), { ...wanted });
        const extendedFile = calculateResultWeight(file({ file: "@@u\\Artist - Title (Extended Mix).flac" }), wanted);
        // The plain file is another version for that title; only the extended one is kept.
        expect(plainFile).toBe(-1);
        expect(extendedFile).toBeGreaterThan(0);
    });

    test("the extended mix gets no bonus (it is refused) when the title is the plain track", () => {
        const plain = calculateResultWeight(file({ file: "@@u\\Artist - Title.flac" }), query);
        expect(plain).toBeGreaterThan(0);
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Title (Extended Mix).flac" }), query)).toBe(-1);
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Title (Club Mix).flac" }), query)).toBe(-1);
    });

    test.each(["Title (Live at Wembley)", "Title (Instrumental)", "Title - Karaoke Version", "Title (A Cappella)"])(
        "another version, %j, is not taken for the track",
        (name) => {
            expect(calculateResultWeight(file({ file: `@@u\\Artist - ${name}.flac` }), query)).toBe(-1);
        }
    );

    test("a live recording is the right file when the title says live", () => {
        const live = { ...query, trackTitle: "Title (Live)" };
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Title (Live).flac" }), live)).toBeGreaterThan(0);
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Title.flac" }), live)).toBe(-1);
    });

    test("a version word in the artist's own name is not a version", () => {
        const band = { ...query, artistName: "Live", trackTitle: "Lightning Crashes" };
        expect(calculateResultWeight(file({ file: "@@u\\Live - Lightning Crashes.flac" }), band)).toBeGreaterThan(0);
        expect(calculateResultWeight(file({ file: "@@u\\Lightning Crashes.flac" }), band)).toBeGreaterThan(0);
        // A second mention is the version.
        expect(calculateResultWeight(file({ file: "@@u\\Live - Lightning Crashes (Live).flac" }), band)).toBe(-1);
    });

    test("a version word inside another word is not a version ('alive', 'delivery')", () => {
        const alive = { ...query, trackTitle: "Alive" };
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Alive.flac" }), alive)).toBeGreaterThan(0);
        expect(calculateResultWeight(file({ file: "@@u\\Artist - Delivery.flac" }), query)).toBeGreaterThan(0);
    });

    test("a peer that reports a speed of 0, or a file of size 0, is still a result", () => {
        expect(calculateResultWeight(file({ speed: 0 }), query)).toBeGreaterThan(0);
        expect(calculateResultWeight(file({ size: 0 }), query)).toBeGreaterThanOrEqual(0);
        expect(rankResults([file({ speed: 0 })], query)).toHaveLength(1);
    });

    test("a faster peer still ranks above a slower one", () => {
        expect(calculateResultWeight(file({ speed: 5000 }), query)).toBeGreaterThan(
            calculateResultWeight(file({ speed: 5 }), query)
        );
    });

    test("gives a bonus when the album name appears in the folder path", () => {
        const noAlbum = calculateResultWeight(file({ file: "@@u\\Other\\Artist - Title.flac" }), query);
        const withAlbum = calculateResultWeight(file({ file: "@@u\\Album\\Artist - Title.flac" }), query);
        expect(withAlbum).toBeGreaterThan(noAlbum);
    });
});

describe("rankResults", () => {
    const query = { artistName: "Artist", trackTitle: "Title", extension: "flac" };

    test("filters out disqualified results and sorts the rest descending", () => {
        const results = [
            file({ user: "bad-ext", file: "@@u\\Title.mp3" }),
            file({ user: "low", bitrate: 128 }),
            file({ user: "high", bitrate: 1400 }),
        ];
        const ranked = rankResults(results, query);
        expect(ranked.map((r) => r.user)).toEqual(["high", "low"]);
    });

    test("caps results to the given limit", () => {
        const results = Array.from({ length: MAX_DOWNLOAD_ATTEMPTS + 5 }, (_, i) =>
            file({ user: `user${i}`, bitrate: 100 + i })
        );
        expect(rankResults(results, query, MAX_DOWNLOAD_ATTEMPTS)).toHaveLength(MAX_DOWNLOAD_ATTEMPTS);
    });

    test("keeps every result when no limit is given", () => {
        const results = Array.from({ length: 30 }, (_, i) => file({ user: `user${i}`, bitrate: 100 + i }));
        expect(rankResults(results, query)).toHaveLength(30);
    });

    test("lists peers with no free slot after every free-slot peer, however good their file", () => {
        const results = [
            file({ user: "queued-great", slots: false, bitrate: 1400, speed: 5000 }),
            file({ user: "free-poor", slots: true, bitrate: 128, speed: 10 }),
            file({ user: "queued-ok", slots: false, bitrate: 900 }),
        ];
        const ranked = rankResults(results, query);
        expect(ranked.map((r) => r.user)).toEqual(["free-poor", "queued-great", "queued-ok"]);
    });
});

describe("parseResultsLimit", () => {
    test("reads a plain number", () => {
        expect(parseResultsLimit("25")).toBe(25);
    });

    test("falls back to the default for anything unusable", () => {
        expect(parseResultsLimit("")).toBe(DEFAULT_RESULTS_LIMIT);
        expect(parseResultsLimit("abc")).toBe(DEFAULT_RESULTS_LIMIT);
        expect(parseResultsLimit("0")).toBe(DEFAULT_RESULTS_LIMIT);
        expect(parseResultsLimit("-3")).toBe(DEFAULT_RESULTS_LIMIT);
        expect(parseResultsLimit(undefined)).toBe(DEFAULT_RESULTS_LIMIT);
    });

    test("caps a huge value", () => {
        expect(parseResultsLimit("100000")).toBe(MAX_HIDDEN_RESULTS);
    });
});

describe("remoteFileName", () => {
    test("takes the file name out of a backslash path whatever the host OS", () => {
        expect(remoteFileName("@@u\\Goodbye (2026)\\Jersey\\Jersey - Goodbye - 02 - U&I.flac")).toBe(
            "Jersey - Goodbye - 02 - U&I.flac"
        );
    });
});

describe("announced audio", () => {
    const query = { artistName: "Artist", trackTitle: "Title", extension: "flac", durationMs: 200_000 };
    const withAttribs = (attribs: SearchResult["attribs"], overrides: Partial<SearchResult> = {}) =>
        file({ ...overrides, attribs });

    test("reads duration (seconds → ms), bitrate, sample rate and bit depth from the peer's attributes", () => {
        expect(
            announcedAudio({
                attribs: {
                    [FileAttribute.Duration]: 200,
                    [FileAttribute.Bitrate]: 1000,
                    [FileAttribute.SampleRate]: 96_000,
                    [FileAttribute.BitDepth]: 24,
                },
            })
        ).toEqual({ durationMs: 200_000, bitrateKbps: 1000, sampleRateHz: 96_000, bitDepth: 24 });
        expect(announcedAudio({})).toEqual({});
    });

    test("disqualifies a file whose announced length is not the track's", () => {
        expect(calculateResultWeight(withAttribs({ [FileAttribute.Duration]: 3600 }), query)).toBe(-1);
        expect(calculateResultWeight(withAttribs({ [FileAttribute.Duration]: 205 }), query)).toBeGreaterThan(0);
        // No announced length: kept, the downloaded file is measured instead.
        expect(calculateResultWeight(withAttribs({}), query)).toBeGreaterThan(0);
    });

    test("prefers 24-bit and ranks below-CD sample rates down", () => {
        const cd = calculateResultWeight(
            withAttribs({ [FileAttribute.BitDepth]: 16, [FileAttribute.SampleRate]: 44_100 }),
            query
        );
        const hiRes = calculateResultWeight(
            withAttribs({ [FileAttribute.BitDepth]: 24, [FileAttribute.SampleRate]: 96_000 }),
            query
        );
        const low = calculateResultWeight(withAttribs({ [FileAttribute.SampleRate]: 22_050 }), query);
        expect(hiRes).toBeGreaterThan(cd);
        expect(low).toBeLessThan(cd);
    });

    test("among queued peers, a shorter queue ranks first", () => {
        const ranked = rankResults(
            [
                file({ user: "long", slots: false, queueLength: 200 }),
                file({ user: "short", slots: false, queueLength: 1 }),
            ],
            query
        );
        expect(ranked.map((r) => r.user)).toEqual(["short", "long"]);
    });

    test("formats what the row shows before the file is downloaded", () => {
        expect(formatAnnouncedAudio({ bitDepth: 24, sampleRateHz: 96_000, bitrateKbps: 3000 })).toBe("24/96");
        expect(formatAnnouncedAudio({ bitDepth: 16, sampleRateHz: 44_100 })).toBe("16/44.1");
        expect(formatAnnouncedAudio({ bitrateKbps: 320 })).toBe("320k");
        expect(formatAnnouncedAudio({ durationMs: 1000 })).toBe("");
        expect(formatAnnouncedAudio(undefined)).toBe("");
    });
});
