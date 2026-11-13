import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    deleteExistingTempFiles,
    findExistingTempFile,
    generateTempStem,
    listTempFilesWithStem,
} from "#flows/musicDownloadFlow/utils/tempFile";
import { type TrackMetadata } from "#flows/musicDownloadFlow/types";

const metadata = {
    uri: "YOUTUBE::TRACK::abc",
    trackName: "Song",
    artists: [{ name: "Artist" }],
} as unknown as TrackMetadata;
const UUID = "123e4567-e89b-12d3-a456-426614174000";

// These look into the temporary download folder, which can hold thousands of files on a slow disk: they are
// asynchronous so the interface does not freeze while they run.

describe("findExistingTempFile", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-temp-"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const touch = (name: string) => fs.writeFileSync(path.join(dir, name), "x");

    it("finds a finished file in any accepted format", async () => {
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.opus`);
        expect(await findExistingTempFile("YouTube", metadata, ["flac", "opus"], dir)).toBe(
            path.join(dir, `YouTube YOUTUBE-TRACK-abc ${UUID}.opus`)
        );
        expect(await findExistingTempFile("YouTube", metadata, "flac", dir)).toBeUndefined();
    });

    it("ignores yt-dlp intermediates, partial files and crashed conversions", async () => {
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.f251.webm`);
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.opus.part`);
        touch(`YouTube YOUTUBE-TRACK-abc ${UUID}.converting.mp3`);
        expect(await findExistingTempFile("YouTube", metadata, ["webm", "mp3", "opus"], dir)).toBeUndefined();
    });

    it("has nothing for a folder that does not exist yet, or a track without a uri", async () => {
        expect(await findExistingTempFile("YouTube", metadata, "opus", path.join(dir, "nope"))).toBeUndefined();
        const noUri = { trackName: "Song" } as unknown as TrackMetadata;
        expect(await findExistingTempFile("YouTube", noUri, "opus", dir)).toBeUndefined();
    });
});

describe("listTempFilesWithStem", () => {
    it("lists the file and its leftovers, nothing else", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-temp-"));
        try {
            const stem = generateTempStem("YouTube", metadata);
            for (const name of [`${stem}.f251.webm`, `${stem}.opus`, "other.opus"]) {
                fs.writeFileSync(path.join(dir, name), "x");
            }
            expect((await listTempFilesWithStem(dir, stem)).map((f) => path.basename(f)).sort()).toEqual(
                [`${stem}.f251.webm`, `${stem}.opus`].sort()
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("listTempFilesWithStem — missing folder", () => {
    it("has no files", async () => {
        expect(await listTempFilesWithStem(path.join(os.tmpdir(), "gm-temp-does-not-exist"), "x")).toEqual([]);
    });
});

describe("deleteExistingTempFiles", () => {
    it("removes this track's files of that format only, and copes with a missing folder", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-temp-"));
        try {
            const flac = path.join(dir, `Soulseek YOUTUBE-TRACK-abc ${UUID}.flac`);
            const mp3 = path.join(dir, `Soulseek YOUTUBE-TRACK-abc ${UUID}.mp3`);
            fs.writeFileSync(flac, "x");
            fs.writeFileSync(mp3, "x");
            await deleteExistingTempFiles("Soulseek", metadata, "flac", dir);
            expect(fs.existsSync(flac)).toBe(false);
            expect(fs.existsSync(mp3)).toBe(true);
            await expect(
                deleteExistingTempFiles("Soulseek", metadata, "flac", path.join(dir, "nope"))
            ).resolves.toBeUndefined();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
