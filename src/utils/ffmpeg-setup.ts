import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import * as https from "https";
import AdmZip from "adm-zip";
import { getBinDir } from "./appPaths";
import { globalLogger } from "#base/logger/logger";

interface GitHubRelease {
    tag_name: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
    published_at: string;
}

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
export async function ensureFfmpeg(autoDownloadBinary = true): Promise<string> {
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

        const binaryName = `ffmpeg_${source.versionId}${binExt()}`;
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

        // Download and extract the ZIP file. The temp name uses a hyphen so it can
        // never be picked up by findExistingBinary()/cleanupOldVersions(), which
        // match the "ffmpeg_" (underscore) prefix — important on non-Windows where
        // the executable has no extension to distinguish it from the archive.
        const zipPath = path.join(getBinDir(), "ffmpeg-download.zip");
        await downloadFile(source.downloadUrl, zipPath);

        // Extract the ffmpeg executable from the ZIP
        globalLogger.debug("Extracting ffmpeg…");
        const zip = new AdmZip(zipPath);
        const ffmpegEntry = zip.getEntries().find((entry) => entry.entryName.endsWith(source.entrySuffix));

        if (!ffmpegEntry) {
            throw new Error("ffmpeg executable not found in the downloaded archive");
        }

        // Extract flat, then rename the extracted file to include the version
        zip.extractEntryTo(ffmpegEntry, getBinDir(), false, true);
        const extractedPath = path.join(getBinDir(), path.basename(ffmpegEntry.entryName));
        await fs.rename(extractedPath, binaryPath);

        // On non-Windows platforms the extracted binary is not executable by default.
        if (process.platform !== "win32") {
            await fs.chmod(binaryPath, 0o755);
        }

        // Clean up the zip file
        await fs.unlink(zipPath);

        globalLogger.info(`Successfully downloaded ffmpeg ${source.versionId} to ${binaryPath}`);
        return binaryPath;
    } catch (error) {
        const existingBinary = await findExistingBinary("ffmpeg_", binExt());
        if (existingBinary) {
            globalLogger.info(`Using existing ffmpeg at ${existingBinary}`);
            return existingBinary;
        }
        // Last resort on non-Windows: rely on a system ffmpeg from PATH (e.g.
        // installed via `brew install ffmpeg`). ytdlp-nodejs accepts a bare
        // command name for ffmpegPath.
        if (process.platform !== "win32") {
            globalLogger.warn(`ffmpeg setup failed (${error}); falling back to system ffmpeg on PATH`);
            return "ffmpeg";
        }
        throw new Error("Failed to fetch latest version from GitHub and no existing binary found");
    }
}

interface FfmpegSource {
    versionId: string;
    downloadUrl: string;
    // An archive entry whose name ends with this string is the ffmpeg executable.
    entrySuffix: string;
}

/**
 * Resolve where to download ffmpeg for the current platform and how to name the
 * cached copy. Windows uses BtbN's win64 GPL build; macOS uses evermeet.cx's
 * static build (x86_64, which also runs on Apple Silicon via Rosetta 2).
 */
async function resolveFfmpegSource(): Promise<FfmpegSource> {
    if (process.platform === "darwin") {
        return {
            versionId: await getEvermeetFfmpegVersion(),
            downloadUrl: "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip",
            entrySuffix: "ffmpeg",
        };
    }

    const release = await getLatestFfmpegRelease();
    return {
        // Use published_at date to create a unique version identifier
        versionId: new Date(release.published_at).toISOString().split("T")[0],
        downloadUrl: `https://github.com/BtbN/FFmpeg-Builds/releases/download/${release.tag_name}/ffmpeg-master-latest-win64-gpl.zip`,
        entrySuffix: "bin/ffmpeg.exe",
    };
}

/**
 * Fetch the current ffmpeg version string from evermeet.cx. Falls back to a
 * date-based identifier if the info endpoint is unavailable, so caching/naming
 * still works.
 */
async function getEvermeetFfmpegVersion(): Promise<string> {
    try {
        const info = await httpsGetJson<{ version?: string }>("https://evermeet.cx/ffmpeg/info/ffmpeg/release");
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

async function getLatestFfmpegRelease(): Promise<GitHubRelease> {
    return httpsGetJson<GitHubRelease>("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest");
}

// Fetch and JSON-parse a URL. Used for the GitHub and evermeet.cx metadata APIs.
async function httpsGetJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { "User-Agent": "Node.js ffmpeg installer" } }, (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data) as T);
                    } catch (error) {
                        reject(new Error(`Failed to parse response from ${url}: ${error}`));
                    }
                });
            })
            .on("error", (error) => {
                reject(new Error(`Failed to fetch ${url}: ${error}`));
            });
    });
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

async function downloadFile(url: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                if (res.statusCode === 302 || res.statusCode === 301) {
                    // Follow redirect
                    if (res.headers.location) {
                        downloadFile(res.headers.location, destination).then(resolve).catch(reject);
                        return;
                    }
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
                    return;
                }

                const fileStream = createWriteStream(destination);
                res.pipe(fileStream);

                fileStream.on("finish", () => {
                    fileStream.close();
                    resolve();
                });

                fileStream.on("error", (error: Error) => {
                    fs.unlink(destination).catch(() => {}); // Clean up partial download
                    reject(error);
                });
            })
            .on("error", (error) => {
                reject(new Error(`Download failed: ${error}`));
            });
    });
}
