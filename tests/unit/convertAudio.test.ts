import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { type Metadata } from "#utils/metadata";
import { probeAudio } from "#utils/probeAudio";
import { convertAudioInto } from "#flows/musicDownloadFlow/utils/convertAudio";
import { OUTPUT_FORMAT_KEYS, type OutputFormatKey } from "#flows/musicDownloadFlow/utils/outputFormat";
import { readTags } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { tagAudioFile } from "#flows/musicDownloadFlow/utils/tagAudioFile";

// These tests run the real ffmpeg / ffprobe, so they need the binaries the app downloads. They use the copies in
// a development checkout's `data/bin` and are skipped where there are none (a fresh clone, CI).
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
    trackTitle: "Don't You Miss Me",
    artists: ["Aki Oke", "Someone Else"],
    albumName: "Test Album",
    year: "2024",
    trackNumber: "3",
    isrc: "GBUM71505078",
    genres: ["House"],
    bpm: 124,
    key: "8A",
};

/** What ffprobe calls the codec each target format is encoded with. */
const CODEC: Record<OutputFormatKey, string> = { flac: "flac", mp3: "mp3", ogg: "vorbis", opus: "opus", m4a: "aac" };

const tags = (value: string | string[] | undefined) => [value ?? ""].flat().join(", ");

describe.skipIf(!binaries.ffmpeg || !binaries.ffprobe)("converting and tagging with the real ffmpeg", () => {
    let dir: string;
    const source = (name: string) => path.join(dir, name);

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-convert-"));
        // Two seconds of a sine wave, once as each kind of download the app can end up with.
        const sine = ["-f", "lavfi", "-i", "sine=frequency=440:duration=2"];
        for (const [name, codec] of [
            ["YtDlp a 1.opus", "libopus"],
            ["YtDlp a 2.flac", "flac"],
            ["Soulseek a 3.mp3", "libmp3lame"],
        ]) {
            await execFileAsync(binaries.ffmpeg!, ["-v", "error", "-y", ...sine, "-c:a", codec, source(name)]);
        }
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test.each(OUTPUT_FORMAT_KEYS)("a lossy download becomes a real %s file, tagged and readable", async (format) => {
        const out = path.join(dir, "out", `track.${format}`);
        await convertAudioInto(source("YtDlp a 1.opus"), out, format);

        const probed = await probeAudio(out);
        expect(probed?.codec).toBe(CODEC[format]);
        expect(probed?.durationMs).toBeGreaterThan(1500);
        expect(probed?.durationMs).toBeLessThan(2500);

        await tagAudioFile(out, metadata);
        expect((await probeAudio(out))?.codec).toBe(CODEC[format]);

        const read = await readTags(out, format);
        expect(tags(read.TITLE)).toBe("Don't You Miss Me");
        expect(tags(read.ARTIST)).toBe("Aki Oke, Someone Else");
        expect(tags(read.ALBUM)).toBe("Test Album");
        expect(tags(read.DATE ?? read.YEAR)).toMatch(/^2024/);
        expect(tags(read.TRACKNUMBER).split("/")[0]).toBe("3");
        expect(tags(read.ISRC)).toBe("GBUM71505078");
    });

    test("only the finished file is left behind: no half-converted copy next to the download", async () => {
        const out = path.join(dir, "out2", "track.mp3");
        await convertAudioInto(source("YtDlp a 2.flac"), out, "mp3");
        expect(fs.readdirSync(dir).filter((f) => f.includes(".converting."))).toEqual([]);
        expect(fs.existsSync(out)).toBe(true);
    });

    test("a failed conversion throws, leaves nothing at the destination, and cleans up after itself", async () => {
        const broken = source("YtDlp broken 4.flac");
        fs.writeFileSync(broken, "this is not audio");
        const out = path.join(dir, "out3", "track.mp3");
        await expect(convertAudioInto(broken, out, "mp3")).rejects.toThrow(/ffmpeg failed/);
        expect(fs.existsSync(out)).toBe(false);
        expect(fs.readdirSync(dir).filter((f) => f.includes(".converting."))).toEqual([]);
    });

    test("an MP3 from Soulseek is tagged as a real MP3, not as FLAC", async () => {
        const out = path.join(dir, "out4", "track.mp3");
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(source("Soulseek a 3.mp3"), out);
        await tagAudioFile(out, metadata);
        const read = await readTags(out, "mp3");
        expect(tags(read.TITLE)).toBe("Don't You Miss Me");
        expect(tags(read.GENRE)).toBe("House");
        expect(tags(read.BPM)).toBe("124");
        // The audio itself is untouched.
        expect((await probeAudio(out))?.codec).toBe("mp3");
    });

    test("re-tagging replaces the old values instead of adding to them", async () => {
        const out = path.join(dir, "out5", "track.opus");
        await convertAudioInto(source("YtDlp a 1.opus"), out, "opus");
        await tagAudioFile(out, metadata);
        await tagAudioFile(out, { ...metadata, trackTitle: "Renamed", artists: ["Only One"] });
        const read = await readTags(out, "opus");
        expect(tags(read.TITLE)).toBe("Renamed");
        expect(tags(read.ARTIST)).toBe("Only One");
    });
});
