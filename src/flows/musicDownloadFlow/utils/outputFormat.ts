import * as path from "path";

/**
 * The audio formats a saved track can be converted to (Settings → Download → "Convert every download").
 *
 * Pure data, no I/O: the UI, the save step and the tests all read the same table. To offer one more format,
 * add a row here and, if it is not FLAC or MP3, make sure `tagAudioFile` (utils/metadata.ts) can write its tags.
 */
export type OutputFormatKey = "flac" | "mp3" | "ogg" | "opus" | "m4a";

export type OutputFormat = {
    /** The file extension, without the dot. */
    ext: OutputFormatKey;
    /** Lossless formats keep every bit of a lossless source; converting a lossy source into one is a "transcode". */
    lossless: boolean;
    /** Nominal bitrate of the lossy encodes, for the badge ("MP3 320"). */
    kbps?: number;
    /** ffmpeg output arguments that select and configure the encoder. */
    ffmpegArgs: readonly string[];
};

export const OUTPUT_FORMATS: Readonly<Record<OutputFormatKey, OutputFormat>> = {
    flac: { ext: "flac", lossless: true, ffmpegArgs: ["-c:a", "flac"] },
    mp3: { ext: "mp3", lossless: false, kbps: 320, ffmpegArgs: ["-c:a", "libmp3lame", "-b:a", "320k"] },
    ogg: { ext: "ogg", lossless: false, kbps: 256, ffmpegArgs: ["-c:a", "libvorbis", "-q:a", "8"] },
    opus: { ext: "opus", lossless: false, kbps: 192, ffmpegArgs: ["-c:a", "libopus", "-b:a", "192k"] },
    m4a: { ext: "m4a", lossless: false, kbps: 256, ffmpegArgs: ["-c:a", "aac", "-b:a", "256k"] },
};

export const OUTPUT_FORMAT_KEYS = Object.keys(OUTPUT_FORMATS) as OutputFormatKey[];

export const DEFAULT_CONVERT_FORMAT: OutputFormatKey = "flac";

/** A stored setting value as a known format; anything unknown (an old or hand-edited file) falls back to FLAC. */
export function parseOutputFormat(value: unknown): OutputFormatKey {
    return typeof value === "string" && Object.hasOwn(OUTPUT_FORMATS, value)
        ? (value as OutputFormatKey)
        : DEFAULT_CONVERT_FORMAT;
}

/** The two settings that decide what format a track is saved in. */
export type ConvertSettings = { convertAudio: boolean; convertFormat: string };

/** The extension of a path, lower-case and without the dot ("" when it has none). */
export function extensionOf(filePath: string): string {
    return path.extname(filePath).slice(1).toLowerCase();
}

/**
 * The extension a track is saved with: the chosen format when "convert" is on, otherwise whatever the
 * downloaded file already is (FLAC when there is no file to ask, e.g. nothing downloaded yet).
 */
export function resolveOutputExtension(settings: ConvertSettings, sourcePath?: string): string {
    if (settings.convertAudio) return OUTPUT_FORMATS[parseOutputFormat(settings.convertFormat)].ext;
    return (sourcePath && extensionOf(sourcePath)) || DEFAULT_CONVERT_FORMAT;
}

/**
 * The extension a track will be saved with, for showing it before anything is saved: `planSave`'s answer, or the
 * setting's when there is no file at all yet.
 */
export function previewOutputExtension(settings: ConvertSettings, downloadPath?: string, savedPath?: string): string {
    return downloadPath || savedPath
        ? planSave(settings, downloadPath, savedPath).extension
        : resolveOutputExtension(settings);
}

/** What saving a track has to do with its files. */
export type SavePlan = {
    /** The extension of the file that ends up in the output folder. */
    extension: string;
    /**
     * `"reuse"`: the track is already saved in that format, so its saved file is renamed / re-tagged in place.
     * `"fromDownload"`: a new file is made from the temporary download (copied, or re-encoded when its format differs).
     */
    mode: "reuse" | "fromDownload";
    /** The temporary download has to be re-encoded (only with `mode: "fromDownload"`). */
    convert: boolean;
};

/**
 * Decides how a track is saved. `downloadPath` is the temporary download (undefined once it was cleaned up),
 * `savedPath` the file the track was already saved as (undefined for a first save).
 *
 * A saved file is only ever re-tagged in place when it already has the wanted format - or when the download is gone
 * and there is nothing to make a new one from. Otherwise the setting wins and the file is made again from the
 * download, replacing the old one: switching the format never turns an FLAC into a mislabelled MP3.
 */
export function planSave(settings: ConvertSettings, downloadPath?: string, savedPath?: string): SavePlan {
    const wanted = resolveOutputExtension(settings, downloadPath ?? savedPath);
    if (savedPath && (!downloadPath || extensionOf(savedPath) === wanted)) {
        return { extension: extensionOf(savedPath), mode: "reuse", convert: false };
    }
    if (!downloadPath) throw new Error("Local file not found");
    return { extension: wanted, mode: "fromDownload", convert: extensionOf(downloadPath) !== wanted };
}
