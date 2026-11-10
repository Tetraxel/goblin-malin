import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { type TrackMetadata } from "#flows/musicDownloadFlow/types";

function formatDurationMs(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}-${String(seconds).padStart(2, "0")}`;
}

function getTempFilePrefix(providerLabel: string, metadata: TrackMetadata): string {
    if (metadata.uri) {
        const uriSlug = metadata.uri.replace(/::/g, "-");
        return `${providerLabel} ${uriSlug}`;
    }
    const artist = metadata.artists?.[0]?.name ?? "Unknown Artist";
    const duration = metadata.duration != null ? ` ${formatDurationMs(metadata.duration)}` : "";
    return `${providerLabel} ${metadata.trackName} - ${artist}${duration}`;
}

export function generateTempFilename(providerLabel: string, metadata: TrackMetadata, format: string): string {
    const prefix = getTempFilePrefix(providerLabel, metadata);
    return `${prefix} ${randomUUID()}.${format}`;
}

/** The name (without extension) a temp file for this download is given: `<provider> <track id or title> <uuid>`. */
export function generateTempStem(providerLabel: string, metadata: TrackMetadata): string {
    return `${getTempFilePrefix(providerLabel, metadata)} ${randomUUID()}`;
}

/**
 * The finished temp file already downloaded for this track, if any. `formats` is the extension(s) to accept:
 * a download whose format is only known once it is done (yt-dlp keeping the original codec) can be any of several.
 * A `.part` / `.ytdl` leftover or an intermediate `….f251.webm` never matches, since none of them ends in a format.
 */
export function findExistingTempFile(
    providerLabel: string,
    metadata: TrackMetadata,
    formats: string | readonly string[],
    dir: string
): string | undefined {
    if (!metadata.uri || !fs.existsSync(dir)) return undefined;
    const prefix = getTempFilePrefix(providerLabel, metadata);
    const suffixes = (typeof formats === "string" ? [formats] : formats).map((format) => `.${format}`);
    // After the prefix a finished file is exactly ` <uuid>.<format>`: that rules out the intermediate `….f251.webm`
    // and a `.converting.mp3` left behind by a crashed conversion.
    const finished = /^ [0-9a-f-]{36}\.[^.]+$/i;
    const match = fs
        .readdirSync(dir)
        .find(
            (f) => f.startsWith(prefix) && finished.test(f.slice(prefix.length)) && suffixes.some((s) => f.endsWith(s))
        );
    return match ? path.join(dir, match) : undefined;
}

/**
 * Every file in `dir` that belongs to the download whose stem is `stem` (the file itself and any leftovers
 * sharing it), so an aborted yt-dlp run whose final name was never known can be cleaned up completely.
 */
export function listTempFilesWithStem(dir: string, stem: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`${stem}.`))
        .map((f) => path.join(dir, f));
}

/**
 * Delete any leftover temp file(s) for this provider/track/format combo. For a
 * provider whose results are deterministic (e.g. yt-dlp, same URL → same bytes),
 * `findExistingTempFile` is the right optimization. For one whose results vary
 * over time (e.g. Soulseek — available peers/files change), reusing an old temp
 * file would silently skip a fresh attempt; call this instead before searching
 * again, so retries don't just pile up unused files in the temp dir either.
 */
export function deleteExistingTempFiles(
    providerLabel: string,
    metadata: TrackMetadata,
    format: string,
    dir: string
): void {
    if (!metadata.uri || !fs.existsSync(dir)) return;
    const prefix = getTempFilePrefix(providerLabel, metadata);
    for (const file of fs.readdirSync(dir)) {
        if (file.startsWith(prefix) && file.endsWith(`.${format}`)) {
            fs.rmSync(path.join(dir, file), { force: true });
        }
    }
}
