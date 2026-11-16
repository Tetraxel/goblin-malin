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
import { buildPictureBlock, coverFromProbe } from "#flows/musicDownloadFlow/utils/embeddedPicture";

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

const metadata: Metadata = { trackTitle: "New Title", artists: ["New Artist"] };

describe("the cover art a file carries (pure parts)", () => {
    const probe = (extra: object) => extra as Parameters<typeof coverFromProbe>[0];

    test("a picture stream ffmpeg can copy is a cover", () => {
        expect(
            coverFromProbe(
                probe({
                    streams: [{ codec_type: "audio" }, { codec_type: "video", codec_name: "png", width: 5, height: 6 }],
                })
            )
        ).toEqual({ kind: "stream", codec: "png", width: 5, height: 6 });
    });

    test("a picture of a codec the muxers do not take is not", () => {
        expect(coverFromProbe(probe({ streams: [{ codec_type: "video", codec_name: "webp" }] }))).toBeUndefined();
        expect(coverFromProbe(probe({ streams: [{ codec_type: "audio" }] }))).toBeUndefined();
    });

    test("a METADATA_BLOCK_PICTURE tag, in whatever case, on the stream or the container", () => {
        expect(coverFromProbe(probe({ streams: [{ tags: { metadata_block_picture: "AAAA" } }] }))).toEqual({
            kind: "block",
            value: "AAAA",
        });
        expect(coverFromProbe(probe({ streams: [], format: { tags: { METADATA_BLOCK_PICTURE: "BBBB" } } }))).toEqual({
            kind: "block",
            value: "BBBB",
        });
    });

    test("a FLAC picture block has the layout the format defines", () => {
        const data = Buffer.from([1, 2, 3]);
        const block = buildPictureBlock("image/png", data, 10, 20);
        expect(block.readUInt32BE(0)).toBe(3); // front cover
        expect(block.readUInt32BE(4)).toBe(9); // length of the MIME type
        expect(block.toString("ascii", 8, 17)).toBe("image/png");
        expect(block.readUInt32BE(17)).toBe(0); // no description
        expect(block.readUInt32BE(21)).toBe(10);
        expect(block.readUInt32BE(25)).toBe(20);
        expect(block.readUInt32BE(37)).toBe(3); // length of the picture
        expect(block.subarray(41)).toEqual(data);
    });
});

describe.skipIf(!binaries.ffmpeg || !binaries.ffprobe)("retagging keeps the cover art", () => {
    let dir: string;
    const ffmpeg = (...args: string[]) => execFileAsync(binaries.ffmpeg!, ["-v", "error", "-y", ...args]);
    const streams = async (file: string) => {
        const { stdout } = await execFileAsync(binaries.ffprobe!, [
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_entries",
            "stream=codec_type,codec_name",
            file,
        ]);
        return (JSON.parse(stdout) as { streams: { codec_type: string; codec_name: string }[] }).streams;
    };
    const pictureOf = async (file: string, out: string) => {
        await ffmpeg("-i", file, "-map", "0:v:0", "-c", "copy", "-f", "image2", "-update", "1", out);
        return fs.readFileSync(out);
    };

    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cover-test-"));
        const sine = ["-f", "lavfi", "-i", "sine=d=1"];
        await ffmpeg("-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", path.join(dir, "small.png"));
        await ffmpeg("-f", "lavfi", "-i", "testsrc=s=700x700", "-frames:v", "1", path.join(dir, "big.png"));

        // M4A with a picture stream.
        await ffmpeg(
            ...sine,
            "-i",
            path.join(dir, "small.png"),
            "-map",
            "0:a",
            "-map",
            "1:v",
            "-c:a",
            "aac",
            "-c:v",
            "copy",
            "-disposition:v",
            "attached_pic",
            path.join(dir, "cover.m4a")
        );
        await ffmpeg(...sine, "-c:a", "aac", path.join(dir, "none.m4a"));

        // Opus / Ogg with a METADATA_BLOCK_PICTURE comment, small and big.
        for (const [name, image] of [
            ["small", "small.png"],
            ["big", "big.png"],
        ] as const) {
            const png = fs.readFileSync(path.join(dir, image));
            const value = buildPictureBlock("image/png", png, 64, 64).toString("base64");
            await ffmpeg(
                ...sine,
                "-c:a",
                "libopus",
                "-metadata",
                `METADATA_BLOCK_PICTURE=${value}`,
                path.join(dir, `${name}.opus`)
            );
        }
        await ffmpeg(...sine, "-c:a", "libopus", path.join(dir, "none.opus"));
        await ffmpeg(...sine, "-c:a", "libvorbis", path.join(dir, "none.ogg"));
    });

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("M4A: the picture stays, as the cover, and the tags are the new ones", async () => {
        const file = path.join(dir, "retag.m4a");
        fs.copyFileSync(path.join(dir, "cover.m4a"), file);
        await tagAudioFile(file, metadata);

        expect((await streams(file)).map((s) => s.codec_type)).toEqual(["audio", "video"]);
        expect(
            (await pictureOf(file, path.join(dir, "back.png"))).equals(fs.readFileSync(path.join(dir, "small.png")))
        ).toBe(true);
        expect((await readTags(file, "m4a")).TITLE).toBe("New Title");
    });

    test.each(["small", "big"])("Opus: a %s picture stays, byte for byte", async (size) => {
        const file = path.join(dir, `retag-${size}.opus`);
        fs.copyFileSync(path.join(dir, `${size}.opus`), file);
        await tagAudioFile(file, metadata);

        expect((await streams(file)).map((s) => s.codec_type)).toEqual(["audio", "video"]);
        const original = fs.readFileSync(path.join(dir, `${size}.png`));
        expect((await pictureOf(file, path.join(dir, `back-${size}.png`))).equals(original)).toBe(true);
        expect((await readTags(file, "opus")).TITLE).toBe("New Title");
        // Nothing left behind: the file beside it, or the one that carried the picture to ffmpeg.
        expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tagging"))).toEqual([]);
    });

    test("a file with no picture gets none", async () => {
        for (const name of ["none.m4a", "none.opus", "none.ogg"]) {
            const file = path.join(dir, `retag-${name}`);
            fs.copyFileSync(path.join(dir, name), file);
            await tagAudioFile(file, metadata);
            expect((await streams(file)).map((s) => s.codec_type)).toEqual(["audio"]);
        }
    });
});
