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
 * Ensure an ffprobe binary is available and return its path. Mirrors
 * `ensureFfmpeg` (ffmpeg-setup.ts) exactly — same source builds, same
 * caching/versioning scheme — since ffprobe ships in the same archives.
 *
 * @param autoDownloadBinary When `true` (default), always check for the
 *   latest release and download it if missing. When `false`, reuse any
 *   existing binary without checking for updates.
 */
export async function ensureFfprobe(autoDownloadBinary = true): Promise<string> {
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
        const existingBinary = await findExistingBinary("ffprobe_", binExt());
        if (existingBinary) {
            globalLogger.info(`Using existing ffprobe at ${existingBinary}`);
            return existingBinary;
        }
        // Last resort on non-Windows: rely on a system ffprobe from PATH (e.g.
        // installed via `brew install ffmpeg`, which includes ffprobe).
        if (process.platform !== "win32") {
            globalLogger.warn(`ffprobe setup failed (${error}); falling back to system ffprobe on PATH`);
            return "ffprobe";
        }
        throw new Error("Failed to fetch latest ffprobe release and no existing binary found");
    }
}

interface FfprobeSource {
    versionId: string;
    downloadUrl: string;
    // An archive entry whose name ends with this string is the ffprobe executable.
    entrySuffix: string;
}

/**
 * Resolve where to download ffprobe for the current platform. Windows reuses
 * BtbN's win64 GPL build (the same archive `ensureFfmpeg` downloads also
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

    const release = await getLatestFfmpegRelease();
    return {
        versionId: new Date(release.published_at).toISOString().split("T")[0],
        downloadUrl: `https://github.com/BtbN/FFmpeg-Builds/releases/download/${release.tag_name}/ffmpeg-master-latest-win64-gpl.zip`,
        entrySuffix: "bin/ffprobe.exe",
    };
}

async function getEvermeetFfprobeVersion(): Promise<string> {
    try {
        const info = await httpsGetJson<{ version?: string }>("https://evermeet.cx/ffmpeg/info/ffprobe/release");
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

async function getLatestFfmpegRelease(): Promise<GitHubRelease> {
    return httpsGetJson<GitHubRelease>("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest");
}

async function httpsGetJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { "User-Agent": "Node.js ffprobe installer" } }, (res) => {
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
                    fs.unlink(destination).catch(() => {});
                    reject(error);
                });
            })
            .on("error", (error) => {
                reject(new Error(`Download failed: ${error}`));
            });
    });
}
