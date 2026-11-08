import * as fs from "fs/promises";
import * as path from "path";
import AdmZip from "adm-zip";
import { getBinDir } from "./appPaths";
import { verifyAgainstPublishedChecksums } from "./checksum";
import { downloadFile } from "./http";
import { globalLogger } from "#base/logger/logger";

export interface ArchiveSource {
    url: string;
    /** Name of the temporary download in the bin folder. Use a hyphen, never the `name_` prefix of a cached binary. */
    tempName: string;
    userAgent: string;
    /** `sha256sum`-style list published by the vendor, when there is one (see `verifyAgainstPublishedChecksums`). */
    checksumsUrl?: string;
    /** File name of the archive as it appears in that list. */
    archiveName?: string;
}

export interface ArchiveTarget {
    /** The archive entry whose name ends with this string is the executable. */
    entrySuffix: string;
    /** Where the extracted executable ends up (versioned name, in the bin folder). */
    destPath: string;
}

// Two callers that need the same archive at the same time (ffmpeg and ffprobe at startup) share one download.
const inflight = new Map<string, Promise<void>>();

/**
 * Download a zip, check it against the vendor's published checksum if there is one, extract the
 * `targets` from it under their final names and delete the zip. Targets that already exist are left
 * alone (on Windows a running executable can't be replaced).
 */
export function installFromZip(source: ArchiveSource, targets: ArchiveTarget[]): Promise<void> {
    let pending = inflight.get(source.url);
    if (!pending) {
        pending = doInstall(source, targets).finally(() => inflight.delete(source.url));
        inflight.set(source.url, pending);
    }
    return pending;
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(
        () => true,
        () => false
    );
}

async function doInstall(source: ArchiveSource, targets: ArchiveTarget[]): Promise<void> {
    const binDir = getBinDir();
    await fs.mkdir(binDir, { recursive: true });
    const zipPath = path.join(binDir, source.tempName);

    try {
        await downloadFile(source.url, zipPath);
        if (source.checksumsUrl && source.archiveName) {
            await verifyAgainstPublishedChecksums(zipPath, source.checksumsUrl, source.archiveName, source.userAgent);
        }

        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();
        for (const target of targets) {
            if (await exists(target.destPath)) continue;
            const entry = entries.find((candidate) => candidate.entryName.endsWith(target.entrySuffix));
            if (!entry) {
                throw new Error(`${target.entrySuffix} not found in the downloaded archive`);
            }
            // Extract flat, then rename to the versioned name.
            zip.extractEntryTo(entry, binDir, false, true);
            await fs.rename(path.join(binDir, path.basename(entry.entryName)), target.destPath);
            // On non-Windows platforms the extracted binary is not executable by default.
            if (process.platform !== "win32") {
                await fs.chmod(target.destPath, 0o755);
            }
            globalLogger.debug(`Extracted ${path.basename(target.destPath)}`);
        }
    } finally {
        // Also on failure: a half-used archive of 200 MB must not stay behind.
        await fs.unlink(zipPath).catch(() => {});
    }
}
