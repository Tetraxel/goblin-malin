import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runFfprobe, type FfprobeOutput } from "#utils/probeAudio";
import { runFfmpeg } from "./ffmpegRun";

/**
 * The cover art a file already carries, so that rewriting its tags does not drop it.
 *
 * The same picture is stored differently by each format: an M4A has it as an attached picture stream (`covr`); Ogg and
 * Opus keep it as a base64 `METADATA_BLOCK_PICTURE` Vorbis comment, which recent ffmpeg shows as a stream and older
 * ffmpeg as a tag. Both are found here.
 */
export type EmbeddedCover =
    /** A picture stream ffmpeg can copy (M4A: map it as an attached picture). */
    | { kind: "stream"; codec: "mjpeg" | "png" | "bmp"; width: number; height: number }
    /** The finished `METADATA_BLOCK_PICTURE` value. */
    | { kind: "block"; value: string };

const COPYABLE = new Set(["mjpeg", "png", "bmp"]);
const BLOCK_TAG = "metadata_block_picture";

/** The cover of the file as ffprobe describes it; none when it has no picture (or ffprobe cannot be run). */
export function coverFromProbe(probe: FfprobeOutput): EmbeddedCover | undefined {
    const tagSets = [...(probe.streams ?? []).map((s) => s.tags), probe.format?.tags];
    for (const tags of tagSets) {
        for (const [key, value] of Object.entries(tags ?? {})) {
            if (key.toLowerCase() === BLOCK_TAG && value) return { kind: "block", value };
        }
    }
    const video = (probe.streams ?? []).find((s) => s.codec_type === "video" && COPYABLE.has(s.codec_name ?? ""));
    if (video) {
        return {
            kind: "stream",
            codec: video.codec_name as "mjpeg" | "png" | "bmp",
            width: video.width ?? 0,
            height: video.height ?? 0,
        };
    }
    return undefined;
}

export async function findCover(filePath: string): Promise<EmbeddedCover | undefined> {
    try {
        return coverFromProbe(await runFfprobe(filePath));
    } catch {
        // No cover found is better than no tags written: the probe is only a convenience here.
        return undefined;
    }
}

/** A FLAC picture block (what `METADATA_BLOCK_PICTURE` holds, base64): front cover, no description. */
export function buildPictureBlock(mime: string, data: Buffer, width: number, height: number): Buffer {
    const u32 = (n: number) => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(n);
        return b;
    };
    const mimeBytes = Buffer.from(mime, "ascii");
    return Buffer.concat([
        u32(3), // front cover
        u32(mimeBytes.length),
        mimeBytes,
        u32(0), // no description
        u32(width),
        u32(height),
        u32(24),
        u32(0), // not an indexed palette
        u32(data.length),
        data,
    ]);
}

/**
 * The `METADATA_BLOCK_PICTURE` value of a cover that ffmpeg shows as a stream: the picture is copied out of the file and
 * wrapped. `undefined` when it is not a format Vorbis comments take (JPEG and PNG only).
 */
export async function pictureBlockValue(filePath: string, cover: EmbeddedCover): Promise<string | undefined> {
    if (cover.kind === "block") return cover.value;
    const mime = cover.codec === "mjpeg" ? "image/jpeg" : cover.codec === "png" ? "image/png" : undefined;
    if (!mime) return undefined;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "goblin-cover-"));
    try {
        const image = path.join(dir, "cover");
        await runFfmpeg(["-i", filePath, "-map", "0:v:0", "-c", "copy", "-f", "image2", "-update", "1", image]);
        const data = await fs.promises.readFile(image);
        return buildPictureBlock(mime, data, cover.width, cover.height).toString("base64");
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
}

/** Most of a Vorbis picture value that goes in the command line itself: Windows refuses lines of about 32,000 characters. */
const INLINE_LIMIT = 8000;

/**
 * The ffmpeg arguments that put `value` on the output's audio stream. A big picture goes through a file (`-/metadata`,
 * ffmpeg reads the option's value from it) because the command line cannot hold it. `cleanup` removes that file.
 */
export async function pictureArgs(value: string): Promise<{ args: string[]; cleanup: () => Promise<void> }> {
    const entry = `METADATA_BLOCK_PICTURE=${value}`;
    if (entry.length <= INLINE_LIMIT) return { args: ["-metadata:s:a:0", entry], cleanup: async () => undefined };
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "goblin-cover-"));
    const file = path.join(dir, "picture.txt");
    await fs.promises.writeFile(file, entry);
    return {
        args: ["-/metadata:s:a:0", file],
        cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }),
    };
}
