import fs from "fs/promises";
import path from "path";
import { Semaphore } from "#utils/semaphore";
import { probeAudio } from "#utils/probeAudio";
import { readTags } from "#flows/musicDownloadFlow/utils/readFileInfo";
import { type AudioFileInfo, type ScanOptions } from "./types";

export const DEFAULT_AUDIO_EXTENSIONS = ["flac", "mp3", "m4a", "ogg", "opus", "wav", "aiff", "aif", "wma", "alac"];

function first(value: string | readonly string[] | undefined): string | undefined {
    const text = Array.isArray(value) ? value[0] : (value as string | undefined);
    return text?.trim() || undefined;
}

function list(value: string | readonly string[] | undefined): string[] {
    if (value === undefined) return [];
    const items = Array.isArray(value) ? [...value] : [value as string];
    return items
        .flatMap((v) => v.split(/\s*;\s*/))
        .map((v) => v.trim())
        .filter(Boolean);
}

/** `goblin.files.readTags`: an audio file's tags read with the app's own readers (FLAC, MP3 natively, the rest by ffprobe). */
export async function readAudioFile(
    filePath: string,
    options: { readTags?: boolean; probeDuration?: boolean } = {}
): Promise<AudioFileInfo> {
    const format = path.extname(filePath).slice(1).toLowerCase();
    const [stat, tags, probe] = await Promise.all([
        fs.stat(filePath),
        options.readTags === false ? Promise.resolve({}) : readTags(filePath, format).catch(() => ({})),
        options.probeDuration ? probeAudio(filePath) : Promise.resolve(null),
    ]);
    const t = tags as Record<string, string | string[]>;
    return Object.freeze({
        path: filePath,
        format,
        sizeBytes: stat.size,
        tags: Object.freeze({ ...t }),
        title: first(t.TITLE),
        artists: Object.freeze(list(t.ARTIST)),
        album: first(t.ALBUM),
        isrc: first(t.ISRC)
            ?.toUpperCase()
            .replace(/[^A-Z0-9]/g, ""),
        durationMs: probe?.durationMs || undefined,
    });
}

/** Every audio file under `folder`, recursively (hidden folders skipped), read 8 at a time. */
export async function scanAudioFolder(folder: string, options: ScanOptions = {}): Promise<AudioFileInfo[]> {
    const wanted = new Set(
        (options.extensions ?? DEFAULT_AUDIO_EXTENSIONS).map((e) => e.replace(/^\./, "").toLowerCase())
    );
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
        if (options.signal?.aborted) return;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return; // a folder we may not read: skipped, like a file manager does
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile() && wanted.has(path.extname(entry.name).slice(1).toLowerCase())) files.push(full);
        }
    };
    await walk(folder);
    files.sort();
    const limiter = new Semaphore(8);
    let done = 0;
    options.onProgress?.(0, files.length);
    const results = await Promise.all(
        files.map((file) =>
            limiter.run(async () => {
                if (options.signal?.aborted) return undefined;
                try {
                    return await readAudioFile(file, {
                        readTags: options.readTags,
                        probeDuration: options.probeDuration,
                    });
                } catch {
                    return undefined;
                } finally {
                    done++;
                    options.onProgress?.(done, files.length);
                }
            })
        )
    );
    if (options.signal?.aborted) throw new DOMException("The scan was stopped", "AbortError");
    return results.filter((r): r is AudioFileInfo => r !== undefined);
}
