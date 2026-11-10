import * as fs from "fs/promises";
import * as path from "path";
import { getBinDir } from "./appPaths";
import { installFromZip } from "./binaryArchive";
import { getLatestWin64Build } from "./ffmpegBuilds";
import { installWin64Archive, versionedBinaryName } from "./ffmpegInstall";
import { httpsGetJson } from "./http";
import { withBinaryAlert } from "./withBinaryAlert";
import { globalLogger } from "#base/logger/logger";

// Executable suffix for locally-stored binaries: ".exe" on Windows, none elsewhere.
function binExt(): string {
    return process.platform === "win32" ? ".exe" : "";
}

/**
 * Ensure an ffmpeg binary is available and return its path.
 *
 * @param autoDownloadBinary When `true` (default), always check GitHub for the
 *   latest release and download it if missing. When `false`, reuse any existing
 *   binary without checking for updates — a download only happens when no binary
 *   exists at all (initialization), never just to update.
 */
export function ensureFfmpeg(autoDownloadBinary = true): Promise<string> {
    return withBinaryAlert(
        "ffmpeg",
        "ffmpeg converts the downloaded audio and extracts it from YouTube's streams, so downloads with yt-dlp fail until it is available.",
        () => setUpFfmpeg(autoDownloadBinary)
    );
}

async function setUpFfmpeg(autoDownloadBinary: boolean): Promise<string> {
    // Updates disabled: reuse an existing binary and skip the latest-version
    // check entirely. Fall through to the normal download only if none exists.
    if (!autoDownloadBinary) {
        const existingBinary = await findExistingBinary("ffmpeg_", binExt());
        if (existingBinary) {
            globalLogger.info(`Auto-download disabled; using existing ffmpeg at ${existingBinary}`);
            return existingBinary;
        }
        globalLogger.info("Auto-download disabled, but no ffmpeg binary found; downloading latest…");
    }

    try {
        // Resolve the download source + a version identifier for the current platform.
        const source = await resolveFfmpegSource();

        const binaryName = versionedBinaryName("ffmpeg", source.versionId);
        const binaryPath = path.join(getBinDir(), binaryName);

        // Check if binary exists
        try {
            await fs.access(binaryPath);
            globalLogger.info(`ffmpeg ${source.versionId} already installed at ${binaryPath}`);
            return binaryPath;
        } catch {
            globalLogger.info(`ffmpeg ${source.versionId} not found, downloading…`);
        }

        // Create bin directory if it doesn't exist
        await fs.mkdir(getBinDir(), { recursive: true });

        // Clean up old ffmpeg versions (optional)
        await cleanupOldVersions("ffmpeg_", binaryName);

        await source.install(binaryPath);

        globalLogger.info(`Successfully downloaded ffmpeg ${source.versionId} to ${binaryPath}`);
        return binaryPath;
    } catch (error) {
        // Say why, even when we then fall back to something usable: a failing update
        // check used to be swallowed here, so a stale binary was never explained.
        globalLogger.warn(`ffmpeg setup failed: ${errorMessage(error)}`);
        const existingBinary = await findExistingBinary("ffmpeg_", binExt());
        if (existingBinary) {
            globalLogger.info(`Using existing ffmpeg at ${existingBinary}`);
            return existingBinary;
        }
        // Deliberately no fallback to an ffmpeg from the user's PATH: which build (and which
        // codecs) a download ends up using must not depend on what is installed on the machine.
        throw new Error(
            `Could not download ffmpeg (${errorMessage(error)}) and no downloaded copy exists in ${getBinDir()}.`
        );
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface FfmpegSource {
    versionId: string;
    /** Download and extract ffmpeg so that it ends up at `binaryPath`. */
    install: (binaryPath: string) => Promise<void>;
}

const USER_AGENT = "Node.js ffmpeg installer";

/**
 * Resolve where to download ffmpeg for the current platform and how to name the
 * cached copy. Windows uses the FFmpeg-Builds win64 GPL build (one archive that also holds
 * ffprobe, see ffmpegInstall.ts); macOS uses evermeet.cx's static build (x86_64, which also
 * runs on Apple Silicon via Rosetta 2). evermeet.cx publishes no checksums (only PGP signatures).
 */
async function resolveFfmpegSource(): Promise<FfmpegSource> {
    if (process.platform === "darwin") {
        return {
            versionId: await getEvermeetFfmpegVersion(),
            install: (binaryPath) =>
                installFromZip(
                    {
                        url: "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip",
                        // Hyphen: never matched by findExistingBinary()/cleanupOldVersions() ("ffmpeg_").
                        tempName: "ffmpeg-download.zip",
                        userAgent: USER_AGENT,
                    },
                    [{ entrySuffix: "ffmpeg", destPath: binaryPath }]
                ),
        };
    }

    // The published_at date is the version identifier (it names the cached binary).
    const build = await getLatestWin64Build(USER_AGENT);
    return { versionId: build.versionId, install: () => installWin64Archive(build, USER_AGENT) };
}

/**
 * Fetch the current ffmpeg version string from evermeet.cx. Falls back to a
 * date-based identifier if the info endpoint is unavailable, so caching/naming
 * still works.
 */
async function getEvermeetFfmpegVersion(): Promise<string> {
    try {
        const info = await httpsGetJson<{ version?: string }>("https://evermeet.cx/ffmpeg/info/ffmpeg/release", {
            userAgent: "Node.js ffmpeg installer",
        });
        if (info.version) {
            return info.version;
        }
    } catch (error) {
        globalLogger.warn(`Failed to fetch evermeet ffmpeg version: ${error}`);
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

        // Sort by name (which includes date) and return the most recent
        binaries.sort().reverse();
        const binaryPath = path.join(getBinDir(), binaries[0]);

        // Verify the file is accessible
        await fs.access(binaryPath);
        return binaryPath;
    } catch (error) {
        globalLogger.warn(`Failed to find existing binary: ${error}`);
        return null;
    }
}

// Clean up old versions to avoid accumulating binaries
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
