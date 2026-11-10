import { describe, expect, test } from "vitest";
import { computeOutputFilename } from "#flows/musicDownloadFlow/utils/computeOutputPath";
import type { CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { cleanOutputFilename } from "#flows/musicDownloadFlow/utils/cleanOutputDir";
import { MAX_NAME_BYTES, sanitizeFileNamePart } from "#flows/musicDownloadFlow/utils/fileName";
import { generateTempStem } from "#flows/musicDownloadFlow/utils/tempFile";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";

const compiled = (artist: string, trackName: string) =>
    ({ artists: [{ name: artist }], trackName }) as CompiledMetadata;

describe("sanitizeFileNamePart", () => {
    test("replaces forbidden characters and removes control characters", () => {
        expect(sanitizeFileNamePart('AC/DC: "Who?"\u0000\u0007')).toBe("AC_DC_ _Who__");
        expect(sanitizeFileNamePart("a\tb\nc")).toBe("abc");
    });

    test("drops trailing dots and spaces", () => {
        expect(sanitizeFileNamePart("Track... ")).toBe("Track");
        expect(sanitizeFileNamePart("  ")).toBe("");
    });

    test("caps the length in bytes without cutting a character in two", () => {
        const long = sanitizeFileNamePart("a".repeat(500));
        expect(Buffer.byteLength(long)).toBe(MAX_NAME_BYTES);

        const wide = sanitizeFileNamePart("é".repeat(500)); // 2 bytes each
        expect(Buffer.byteLength(wide)).toBeLessThanOrEqual(MAX_NAME_BYTES);
        expect(wide).toBe("é".repeat(MAX_NAME_BYTES / 2));

        const emoji = sanitizeFileNamePart("🎵".repeat(100), 10); // 4 bytes each: room for two
        expect(emoji).toBe("🎵🎵");
    });

    test("a name cut at a dot does not end with it", () => {
        expect(sanitizeFileNamePart(`${"a".repeat(9)}. b`, 10)).toBe("a".repeat(9));
    });
});

describe("the automatic file name is cleaned like a typed one", () => {
    test("control characters and a very long title", () => {
        const name = computeOutputFilename(compiled("Artist", `Ti\u0000tle ${"x".repeat(400)}`));
        expect(name.endsWith(".flac")).toBe(true);
        expect(name.includes("\u0000")).toBe(false);
        expect(Buffer.byteLength(name)).toBeLessThanOrEqual(MAX_NAME_BYTES + ".flac".length);
    });

    test("a typed name is capped too", () => {
        const name = cleanOutputFilename("y".repeat(400))!;
        expect(Buffer.byteLength(name)).toBeLessThanOrEqual(MAX_NAME_BYTES + ".flac".length);
    });

    test("stays the same for an ordinary track", () => {
        expect(computeOutputFilename(compiled("Aki Oke", "don't you miss me"))).toBe(
            "Aki Oke - don't you miss me.flac"
        );
    });
});

describe("the temp file name of a track with no uri", () => {
    const track = (trackName: string, artist: string) =>
        ({ trackName, artists: [{ name: artist }], fetchedAt: "" }) as unknown as TrackMetadata;

    test("a `/` in the title or artist does not make a sub-folder", () => {
        const stem = generateTempStem("Soulseek", track("Back/In Black", "AC/DC"));
        expect(stem).not.toMatch(/[/\\]/);
        expect(stem.startsWith("Soulseek Back_In Black - AC_DC")).toBe(true);
    });

    test("a very long title keeps the whole name short enough to be a file name", () => {
        const stem = generateTempStem("Soulseek", track("t".repeat(500), "a".repeat(500)));
        expect(Buffer.byteLength(stem)).toBeLessThan(200);
    });
});
