import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { type Metadata } from "#utils/metadata";
import { probeAudio } from "#utils/probeAudio";
import { readTags } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { tagAudioFile } from "#flows/musicDownloadFlow/utils/tagAudioFile";
import { addMp4Items } from "#flows/musicDownloadFlow/utils/mp4Freeform";

// Real ffmpeg / ffprobe, from a development checkout's `data/bin`; skipped where there are none (a fresh clone, CI).
const binaries = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- vi.hoisted runs before any import
    const { readdirSync } = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join, resolve } = require("path") as typeof import("path");
    const dir = resolve("data", "bin");
    const find = (prefix: string): string | undefined => {
        try {
            const name = readdirSync(dir)
                .filter((f) => f.startsWith(prefix) && !f.endsWith(".zip"))
                .sort()
                .pop();
            return name ? join(dir, name) : undefined;
        } catch {
            return undefined;
        }
    };
    return { ffmpeg: find("ffmpeg_"), ffprobe: find("ffprobe_") };
});

vi.mock("#utils/ffmpeg-setup", () => ({ ensureFfmpeg: async () => binaries.ffmpeg }));
vi.mock("#utils/ffprobe-setup", () => ({ ensureFfprobe: async () => binaries.ffprobe }));

const execFileAsync = promisify(execFile);

const metadata: Metadata = {
    trackTitle: "My Title",
    artists: ["My Artist"],
    albumName: "My Album",
    year: "2024",
    trackNumber: "3",
    isrc: "GBUM71505078",
    genres: ["House"],
    bpm: 124,
    musicBrainzTrackId: "11111111-1111-1111-1111-111111111111",
    musicBrainzAlbumId: "22222222-2222-2222-2222-222222222222",
};

/** The types of every atom in the file, at any depth: a check that does not go through ffmpeg. */
function atomTypes(buf: Buffer): string[] {
    const found: string[] = [];
    const walk = (start: number, end: number, skip = 0) => {
        let at = start + skip;
        while (at + 8 <= end) {
            const size = buf.readUInt32BE(at);
            const type = buf.toString("latin1", at + 4, at + 8);
            if (size < 8 || at + size > end) return;
            found.push(type);
            if (type === "moov" || type === "udta" || type === "ilst") walk(at + 8, at + size);
            if (type === "meta") walk(at + 8, at + size, 4);
            at += size;
        }
    };
    walk(0, buf.length);
    return found;
}

describe.skipIf(!binaries.ffmpeg || !binaries.ffprobe)("M4A tags, as software other than ffmpeg reads them", () => {
    let dir: string;

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-m4a-"));
        const sine = ["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac"];
        await execFileAsync(binaries.ffmpeg!, ["-v", "error", "-y", ...sine, path.join(dir, "plain.m4a")]);
        await execFileAsync(binaries.ffmpeg!, [
            "-v",
            "error",
            "-y",
            ...sine,
            "-movflags",
            "+faststart",
            path.join(dir, "faststart.m4a"),
        ]);
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test("the title, artist and album are the standard iTunes atoms, not mdta key/value pairs", async () => {
        const file = path.join(dir, "standard.m4a");
        fs.copyFileSync(path.join(dir, "plain.m4a"), file);
        await tagAudioFile(file, metadata);

        const types = atomTypes(fs.readFileSync(file));
        expect(types).toContain("©nam");
        expect(types).toContain("©ART");
        expect(types).toContain("©alb");
        // The form nothing but ffmpeg reads.
        expect(types).not.toContain("keys");
        expect(types).not.toContain("mdta");
    });

    test("ISRC, tempo and the MusicBrainz ids are written as the atoms Picard uses, and still read back", async () => {
        const file = path.join(dir, "extras.m4a");
        fs.copyFileSync(path.join(dir, "plain.m4a"), file);
        await tagAudioFile(file, metadata);

        const raw = fs.readFileSync(file);
        const types = atomTypes(raw);
        expect(types).toContain("----");
        expect(types).toContain("tmpo");
        expect(raw.includes(Buffer.from("MusicBrainz Track Id"))).toBe(true);

        const read = await readTags(file, "m4a");
        expect(read.TITLE).toBe("My Title");
        expect(read.ISRC).toBe("GBUM71505078");
        expect(read.MUSICBRAINZ_TRACKID).toBe("11111111-1111-1111-1111-111111111111");
        expect(read.MUSICBRAINZ_ALBUMID).toBe("22222222-2222-2222-2222-222222222222");
    });

    test("the file still plays through: audio untouched, no decoding error", async () => {
        const file = path.join(dir, "plays.m4a");
        fs.copyFileSync(path.join(dir, "plain.m4a"), file);
        await tagAudioFile(file, metadata);
        expect((await probeAudio(file))?.codec).toBe("aac");
        const { stderr } = await execFileAsync(binaries.ffmpeg!, ["-v", "error", "-i", file, "-f", "null", "-"]);
        expect(stderr.trim()).toBe("");
    });

    test("with the index at the front of the file, the sample offsets are moved along with the new atoms", async () => {
        const file = path.join(dir, "moved.m4a");
        fs.copyFileSync(path.join(dir, "faststart.m4a"), file);
        const before = atomTypes(fs.readFileSync(file));
        expect(before.indexOf("moov")).toBeLessThan(before.indexOf("mdat"));

        expect(await addMp4Items(file, [{ name: "ISRC", value: "GBUM71505078" }], 120)).toBe(true);

        const { stderr } = await execFileAsync(binaries.ffmpeg!, ["-v", "error", "-i", file, "-f", "null", "-"]);
        expect(stderr.trim()).toBe("");
        expect((await probeAudio(file))?.durationMs).toBeGreaterThan(1500);
        expect((await readTags(file, "m4a")).ISRC).toBe("GBUM71505078");
    });

    test("a file that is not an MP4 is left alone", async () => {
        const file = path.join(dir, "not-mp4.m4a");
        fs.writeFileSync(file, "this is not audio at all");
        expect(await addMp4Items(file, [{ name: "ISRC", value: "x" }])).toBe(false);
        expect(fs.readFileSync(file, "utf8")).toBe("this is not audio at all");
    });
});
