import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { type TrackMetadata } from "#flows/musicDownloadFlow/types";
import { sanitizeFileNamePart } from "./fileName";

function formatDurationMs(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}-${String(seconds).padStart(2, "0")}`;
}

/** Room for each of the two name parts of a temp file, which also holds the provider label and a uuid. */
const TEMP_NAME_PART_BYTES = 60;

function getTempFilePrefix(providerLabel: string, metadata: TrackMetadata): string {
    if (metadata.uri) {
        const uriSlug = metadata.uri.replace(/::/g, "-");
        return `${providerLabel} ${uriSlug}`;
    }
    // The names are the provider's own text: a `/` in "AC/DC" must not become a folder. They are capped so that the
    // uuid, the extension and yt-dlp's `.f251.webm` suffixes still fit in a file name.
    const artist = sanitizeFileNamePart(metadata.artists?.[0]?.name ?? "Unknown Artist", TEMP_NAME_PART_BYTES);
    const title = sanitizeFileNamePart(metadata.trackName ?? "", TEMP_NAME_PART_BYTES);
    const duration = metadata.duration != null ? ` ${formatDurationMs(metadata.duration)}` : "";
    return `${providerLabel} ${title} - ${artist}${duration}`;
}

export function generateTempFilename(providerLabel: string, metadata: TrackMetadata, format: string): string {
    const prefix = getTempFilePrefix(providerLabel, metadata);
    return `${prefix} ${randomUUID()}.${format}`;
}

/** The name (without extension) a temp file for this download is given: `<provider> <track id or title> <uuid>`. */
export function generateTempStem(providerLabel: string, metadata: TrackMetadata): string {
    return `${getTempFilePrefix(providerLabel, metadata)} ${randomUUID()}`;
}

/** The names in `dir`, or none when the folder does not exist (yet). Never blocks the UI thread. */
async function listDir(dir: string): Promise<string[]> {
    try {
        return await fs.promises.readdir(dir);
    } catch {
        return [];
    }
}

/**
 * The finished temp file already downloaded for this track, if any. `formats` is the extension(s) to accept:
 * a download whose format is only known once it is done (yt-dlp keeping the original codec) can be any of several.
 * A `.part` / `.ytdl` leftover or an intermediate `….f251.webm` never matches, since none of them ends in a format.
 *
 * Asynchronous: the temporary folder can hold thousands of files, and sits on a slow or scanned disk more often
 * than not, so listing it must not freeze the interface.
 */
export async function findExistingTempFile(
    providerLabel: string,
    metadata: TrackMetadata,
    formats: string | readonly string[],
    dir: string
): Promise<string | undefined> {
    if (!metadata.uri) return undefined;
    const prefix = getTempFilePrefix(providerLabel, metadata);
    const suffixes = (typeof formats === "string" ? [formats] : formats).map((format) => `.${format}`);
    // After the prefix a finished file is exactly ` <uuid>.<format>`: that rules out the intermediate `….f251.webm`
    // and a `.converting.mp3` left behind by a crashed conversion.
    const finished = /^ [0-9a-f-]{36}\.[^.]+$/i;
    const match = (await listDir(dir)).find(
        (f) => f.startsWith(prefix) && finished.test(f.slice(prefix.length)) && suffixes.some((s) => f.endsWith(s))
    );
    return match ? path.join(dir, match) : undefined;
}

/**
 * Every file in `dir` that belongs to the download whose stem is `stem` (the file itself and any leftovers
 * sharing it), so an aborted yt-dlp run whose final name was never known can be cleaned up completely.
 */
export async function listTempFilesWithStem(dir: string, stem: string): Promise<string[]> {
    return (await listDir(dir)).filter((f) => f.startsWith(`${stem}.`)).map((f) => path.join(dir, f));
}

/**
 * Delete any leftover temp file(s) for this provider/track/format combo. For a
 * provider whose results are deterministic (e.g. yt-dlp, same URL → same bytes),
 * `findExistingTempFile` is the right optimization. For one whose results vary
 * over time (e.g. Soulseek — available peers/files change), reusing an old temp
 * file would silently skip a fresh attempt; call this instead before searching
 * again, so retries don't just pile up unused files in the temp dir either.
 */
export async function deleteExistingTempFiles(
    providerLabel: string,
    metadata: TrackMetadata,
    format: string,
    dir: string
): Promise<void> {
    if (!metadata.uri) return;
    const prefix = getTempFilePrefix(providerLabel, metadata);
    for (const file of await listDir(dir)) {
        if (file.startsWith(prefix) && file.endsWith(`.${format}`)) {
            await fs.promises.rm(path.join(dir, file), { force: true });
        }
    }
}
