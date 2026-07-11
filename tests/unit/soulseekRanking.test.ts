import { describe, test, expect } from "vitest";
import type { SlskFile } from "slsk-client";
import {
    cleanSearchTerm,
    calculateResultWeight,
    rankResults,
    MAX_DOWNLOAD_ATTEMPTS,
} from "#flows/musicDownloadFlow/services/download-providers/soulseek/ranking";

function file(overrides: Partial<SlskFile> = {}): SlskFile {
    return {
        user: "someuser",
        file: "@@someuser\\Music\\Artist - Title.flac",
        size: 30 * 1024 * 1024,
        slots: true,
        bitrate: 1000,
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
});

describe("calculateResultWeight", () => {
    const query = { artistName: "Artist", trackTitle: "Title", albumName: "Album", extension: "flac" };

    test("disqualifies a result with the wrong extension", () => {
        expect(calculateResultWeight(file({ file: "@@u\\Title.mp3" }), query)).toBe(-1);
    });

    test("disqualifies a result with no free slots", () => {
        expect(calculateResultWeight(file({ slots: false }), query)).toBe(-1);
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

    test("gives a bonus to extended-mix filenames", () => {
        const plain = calculateResultWeight(file({ file: "@@u\\Artist - Title.flac" }), query);
        const extended = calculateResultWeight(file({ file: "@@u\\Artist - Title (Extended Mix).flac" }), query);
        expect(extended).toBeGreaterThan(plain);
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

    test("caps results to MAX_DOWNLOAD_ATTEMPTS", () => {
        const results = Array.from({ length: MAX_DOWNLOAD_ATTEMPTS + 5 }, (_, i) =>
            file({ user: `user${i}`, bitrate: 100 + i })
        );
        expect(rankResults(results, query)).toHaveLength(MAX_DOWNLOAD_ATTEMPTS);
    });
});
