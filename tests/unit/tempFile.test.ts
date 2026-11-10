import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findExistingTempFile, generateTempStem, listTempFilesWithStem } from "#flows/musicDownloadFlow/utils/tempFile";
import { type TrackMetadata } from "#flows/musicDownloadFlow/types";

const metadata = {
    uri: "YOUTUBE::TRACK::abc",
    trackName: "Song",
    artists: [{ name: "Artist" }],
} as unknown as TrackMetadata;
const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("findExistingTempFile", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-temp-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const touch = (name: string) => fs.writeFileSync(path.join(dir, name), "x");

    it("finds a finished file in any accepted format", () => {
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.opus`);
        expect(findExistingTempFile("YouTube", metadata, ["flac", "opus"], dir)).toBe(
            path.join(dir, `YouTube YOUTUBE-TRACK-abc ${UUID}.opus`)
        );
        expect(findExistingTempFile("YouTube", metadata, "flac", dir)).toBeUndefined();
    });

    it("ignores yt-dlp intermediates, partial files and crashed conversions", () => {
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.f251.webm`);
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.opus.part`);
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.converting.mp3`);
        expect(findExistingTempFile("YouTube", metadata, ["webm", "mp3", "opus"], dir)).toBeUndefined();
    });
});

describe("listTempFilesWithStem", () => {
    it("lists the file and its leftovers, nothing else", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-temp-"));
        try {
            const stem = generateTempStem("YouTube", metadata);
            for (const name of [`${stem}.f251.webm`, `${stem}.opus`, "other.opus"]) {
                fs.writeFileSync(path.join(dir, name), "x");
            }
            expect(
                listTempFilesWithStem(dir, stem)
                    .map((f) => path.basename(f))
                    .sort()
            ).toEqual([`${stem}.f251.webm`, `${stem}.opus`].sort());
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
