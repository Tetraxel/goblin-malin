import * as fs from "fs/promises";
import * as path from "path";
import AdmZip from "adm-zip";
import { getBinDir } from "./appPaths";
import { getLatestWin64Build } from "./ffmpegBuilds";
import { downloadFile, httpsGetJson } from "./http";
import { withBinaryAlert } from "./withBinaryAlert";
import { globalLogger } from "#base/logger/logger";

// Executable suffix for locally-stored binaries: ".exe" on Windows, none elsewhere.
function binExt(): string {
    return process.platform === "win32" ? ".exe" : "";
}

/**
 * Ensure an ffprobe binary is available and return its path. Mirrors
 * `ensureFfmpeg` (ffmpeg-setup.ts) exactly — same source builds, same
 * caching/versioning scheme — since ffprobe ships in the same archives.
 *
 * @param autoDownloadBinary When `true` (default), always check for the
 *   latest release and download it if missing. When `false`, reuse any
 *   existing binary without checking for updates.
 */
export function ensureFfprobe(autoDownloadBinary = true): Promise<string> {
    return withBinaryAlert(
        "ffprobe",
        "ffprobe reads the codec and bitrate of downloaded files, so those details are missing until it is available.",
        () => setUpFfprobe(autoDownloadBinary)
    );
}

async function setUpFfprobe(autoDownloadBinary: boolean): Promise<string> {
    if (!autoDownloadBinary) {
        const existingBinary = await findExistingBinary("ffprobe_", binExt());
        if (existingBinary) {
            globalLogger.info(`Auto-download disabled; using existing ffprobe at ${existingBinary}`);
            return existingBinary;
        }
        globalLogger.info("Auto-download disabled, but no ffprobe binary found; downloading latest…");
    }

    try {
        const source = await resolveFfprobeSource();

        const binaryName = `ffprobe_${source.versionId}${binExt()}`;
        const binaryPath = path.join(getBinDir(), binaryName);

        try {
            await fs.access(binaryPath);
            globalLogger.info(`ffprobe ${source.versionId} already installed at ${binaryPath}`);
            return binaryPath;
        } catch {
            globalLogger.info(`ffprobe ${source.versionId} not found, downloading…`);
        }

        await fs.mkdir(getBinDir(), { recursive: true });
        await cleanupOldVersions("ffprobe_", binaryName);

        // Temp name uses a hyphen so it's never picked up by findExistingBinary()/
        // cleanupOldVersions(), which match the "ffprobe_" (underscore) prefix.
        const zipPath = path.join(getBinDir(), "ffprobe-download.zip");
        await downloadFile(source.downloadUrl, zipPath);

        globalLogger.debug("Extracting ffprobe…");
        const zip = new AdmZip(zipPath);
        const ffprobeEntry = zip.getEntries().find((entry) => entry.entryName.endsWith(source.entrySuffix));

        if (!ffprobeEntry) {
            throw new Error("ffprobe executable not found in the downloaded archive");
        }

        zip.extractEntryTo(ffprobeEntry, getBinDir(), false, true);
        const extractedPath = path.join(getBinDir(), path.basename(ffprobeEntry.entryName));
        await fs.rename(extractedPath, binaryPath);

        if (process.platform !== "win32") {
            await fs.chmod(binaryPath, 0o755);
        }

        await fs.unlink(zipPath);

        globalLogger.info(`Successfully downloaded ffprobe ${source.versionId} to ${binaryPath}`);
        return binaryPath;
    } catch (error) {
        // Say why, even when we then fall back to something usable (see ensureFfmpeg).
        globalLogger.warn(`ffprobe setup failed: ${errorMessage(error)}`);
        const existingBinary = await findExistingBinary("ffprobe_", binExt());
        if (existingBinary) {
            globalLogger.info(`Using existing ffprobe at ${existingBinary}`);
            return existingBinary;
        }
        // No fallback to an ffprobe from the user's PATH, for the same reason as ffmpeg.
        throw new Error(
            `Could not download ffprobe (${errorMessage(error)}) and no downloaded copy exists in ${getBinDir()}.`
        );
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface FfprobeSource {
    versionId: string;
    downloadUrl: string;
    // An archive entry whose name ends with this string is the ffprobe executable.
    entrySuffix: string;
}

/**
 * Resolve where to download ffprobe for the current platform. Windows reuses
 * the FFmpeg-Builds win64 GPL build (the same archive `ensureFfmpeg` downloads also
 * contains `bin/ffprobe.exe`); macOS uses evermeet.cx's separate ffprobe
 * static build (x86_64, runs on Apple Silicon via Rosetta 2).
 */
async function resolveFfprobeSource(): Promise<FfprobeSource> {
    if (process.platform === "darwin") {
        return {
            versionId: await getEvermeetFfprobeVersion(),
            downloadUrl: "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip",
            entrySuffix: "ffprobe",
        };
    }

    const build = await getLatestWin64Build("Node.js ffprobe installer");
    return { ...build, entrySuffix: "bin/ffprobe.exe" };
}

async function getEvermeetFfprobeVersion(): Promise<string> {
    try {
        const info = await httpsGetJson<{ version?: string }>("https://evermeet.cx/ffmpeg/info/ffprobe/release", {
            userAgent: "Node.js ffprobe installer",
        });
        if (info.version) {
            return info.version;
        }
    } catch (error) {
        globalLogger.warn(`Failed to fetch evermeet ffprobe version: ${error}`);
    }
    return new Date().toISOString().split("T")[0];
}

async function findExistingBinary(prefix: string, suffix: string): Promise<string | null> {
    try {
        const files = await fs.readdir(getBinDir());
        const binaries = files.filter((file) => file.startsWith(prefix) && file.endsWith(suffix));

        if (binaries.length === 0) {
            return null;
        }

        binaries.sort().reverse();
        const binaryPath = path.join(getBinDir(), binaries[0]);

        await fs.access(binaryPath);
        return binaryPath;
    } catch (error) {
        globalLogger.warn(`Failed to find existing binary: ${error}`);
        return null;
    }
}

async function cleanupOldVersions(prefix: string, currentVersion: string): Promise<void> {
    try {
        const files = await fs.readdir(getBinDir());
        const oldVersions = files.filter(
            (file) => file.startsWith(prefix) && file.endsWith(binExt()) && file !== currentVersion
        );

        for (const file of oldVersions) {
            await fs.unlink(path.join(getBinDir(), file));
            globalLogger.info(`Cleaned up old version: ${file}`);
        }
    } catch (error) {
        globalLogger.warn(`Failed to cleanup old versions: ${error}`);
    }
}
