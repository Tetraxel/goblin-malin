import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import AdmZip from "adm-zip";
import { getBinDir } from "./appPaths";
import { EXTRACT_DIR_PREFIX } from "./binaryFiles";
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
    /** An archive that cannot be checked against that list is refused (it holds executables that will be run). */
    requireChecksum?: boolean;
}

export interface ArchiveTarget {
    /** The archive entry whose name ends with this string is the executable. */
    entrySuffix: string;
    /** Where the extracted executable ends up (versioned name, in the bin folder). */
    destPath: string;
}

const execFileAsync = promisify(execFile);

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
            await verifyAgainstPublishedChecksums(zipPath, source.checksumsUrl, source.archiveName, source.userAgent, {
                required: source.requireChecksum,
            });
        } else if (source.requireChecksum) {
            throw new Error(`No checksum list is known for ${source.url}: it is not installed unverified`);
        }

        for (const target of targets) {
            if (await exists(target.destPath)) continue;
            await extractEntry(zipPath, target, binDir);
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

/**
 * Extracts the entry of `target` under its final name. The work is done by 7-Zip (bundled with the app, see
 * `7zip-bin`) in its own process: the archive is about 200 MB, and reading it into memory and inflating a ~130 MB
 * executable in this process freezes the interface for seconds (twice: ffmpeg and ffprobe). Where 7-Zip cannot be run
 * (a platform the package has no build for), the in-process extraction is used instead.
 */
async function extractEntry(zipPath: string, target: ArchiveTarget, binDir: string): Promise<void> {
    // Extracted into a folder of its own and renamed: no half-written file ever has the final name, and a file that
    // happens to be called like the entry (`ffmpeg.exe` already in the bin folder) is neither used nor overwritten.
    // A kill in the middle leaves this folder behind: `removeOldVersions` clears the old ones.
    const stage = await fs.mkdtemp(path.join(binDir, EXTRACT_DIR_PREFIX));
    try {
        let extracted: string;
        try {
            extracted = await extractWithSevenZip(zipPath, target.entrySuffix, stage);
        } catch (error) {
            if ((error as Error).message.includes("not found in the downloaded archive")) throw error;
            globalLogger.warn(
                `7-Zip could not extract the archive (${(error as Error).message}); extracting in-process`
            );
            extracted = extractInProcess(zipPath, target.entrySuffix, stage);
        }
        await fs.rename(extracted, target.destPath);
    } finally {
        await fs.rm(stage, { recursive: true, force: true });
    }
}

/** The names of the archive's entries, as 7-Zip lists them (`7za l -slt`: one `Path = …` line per entry). */
export function parseSevenZipListing(listing: string): string[] {
    return (
        listing
            .split(/\r?\n/)
            .filter((line) => line.startsWith("Path = "))
            .map((line) => line.slice("Path = ".length))
            // The first "Path" is the archive itself.
            .slice(1)
    );
}

async function extractWithSevenZip(zipPath: string, entrySuffix: string, stage: string): Promise<string> {
    const { path7za } = await import("7zip-bin");
    const run = (args: string[]) =>
        execFileAsync(path7za, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).then(({ stdout }) => stdout);

    const entries = parseSevenZipListing(await run(["l", "-slt", zipPath]));
    const wanted = entrySuffix.replace(/\\/g, "/");
    const entry = entries.find((name) => name.replace(/\\/g, "/").endsWith(wanted));
    if (!entry) throw new Error(`${entrySuffix} not found in the downloaded archive`);

    // `e`: without the folders the entry is in. `-y`: no questions; none can be answered.
    await run(["e", zipPath, `-o${stage}`, "-y", entry]);
    return path.join(stage, path.basename(entry.replace(/\\/g, "/")));
}

function extractInProcess(zipPath: string, entrySuffix: string, stage: string): string {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntries().find((candidate) => candidate.entryName.endsWith(entrySuffix));
    if (!entry) throw new Error(`${entrySuffix} not found in the downloaded archive`);
    zip.extractEntryTo(entry, stage, false, true);
    return path.join(stage, path.basename(entry.entryName));
}
