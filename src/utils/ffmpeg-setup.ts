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

export async function ensureFfmpeg(): Promise<string> {
    try {
        let release: GitHubRelease | null = null;

        // Try to get the latest version from GitHub
        try {
            release = await getLatestFfmpegRelease();
        } catch (error) {
            globalLogger.warn(`Failed to fetch latest ffmpeg release: ${error}`);
            globalLogger.info("Attempting to use existing binary…");
        }

        // If GitHub API failed, try to find existing binary
        if (!release) {
            throw new Error("ffmpeg release not found");
        }

        // Use published_at date to create a unique version identifier
        const versionDate = new Date(release.published_at).toISOString().split("T")[0];
        const binaryName = `ffmpeg_${versionDate}.exe`;
        const binaryPath = path.join(getBinDir(), binaryName);

        // Check if binary exists
        try {
            await fs.access(binaryPath);
            globalLogger.info(`ffmpeg ${versionDate} already installed at ${binaryPath}`);
            return binaryPath;
        } catch {
            globalLogger.info(`ffmpeg ${versionDate} not found, downloading…`);
        }

        // Create bin directory if it doesn't exist
        await fs.mkdir(getBinDir(), { recursive: true });

        // Clean up old ffmpeg versions (optional)
        await cleanupOldVersions("ffmpeg_", binaryName);

        // Download and extract the ZIP file
        const zipName = "ffmpeg-master-latest-win64-gpl.zip";
        const downloadUrl = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${release.tag_name}/${zipName}`;
        const zipPath = path.join(getBinDir(), zipName);

        await downloadFile(downloadUrl, zipPath);

        // Extract ffmpeg.exe from the ZIP
        globalLogger.info("Extracting ffmpeg.exe…");
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();

        // Find the ffmpeg.exe entry in the zip
        const ffmpegEntry = zipEntries.find((entry) => entry.entryName.endsWith("bin/ffmpeg.exe"));

        if (!ffmpegEntry) {
            throw new Error("ffmpeg.exe not found in the downloaded archive");
        }

        // Extract to the target location
        zip.extractEntryTo(ffmpegEntry, getBinDir(), false, true);

        // Rename the extracted file to include version
        const extractedPath = path.join(getBinDir(), "ffmpeg.exe");
        await fs.rename(extractedPath, binaryPath);

        // Clean up the zip file
        await fs.unlink(zipPath);

        globalLogger.info(`Successfully downloaded ffmpeg ${versionDate} to ${binaryPath}`);
        return binaryPath;
    } catch {
        const existingBinary = await findExistingBinary("ffmpeg_", ".exe");
        if (existingBinary) {
            globalLogger.info(`Using existing ffmpeg at ${existingBinary}`);
            return existingBinary;
        }
        throw new Error("Failed to fetch latest version from GitHub and no existing binary found");
    }
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
    return new Promise((resolve, reject) => {
        https
            .get(
                "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest",
                {
                    headers: {
                        "User-Agent": "Node.js ffmpeg installer",
                    },
                },
                (res) => {
                    let data = "";

                    res.on("data", (chunk) => {
                        data += chunk;
                    });

                    res.on("end", () => {
                        try {
                            const release: GitHubRelease = JSON.parse(data);
                            resolve(release);
                        } catch (error) {
                            reject(new Error(`Failed to parse GitHub API response: ${error}`));
                        }
                    });
                }
            )
            .on("error", (error) => {
                reject(new Error(`Failed to fetch latest version: ${error}`));
            });
    });
}

// Clean up old versions to avoid accumulating binaries
async function cleanupOldVersions(prefix: string, currentVersion: string): Promise<void> {
    try {
        const files = await fs.readdir(getBinDir());
        const oldVersions = files.filter(
            (file) => file.startsWith(prefix) && file.endsWith(".exe") && file !== currentVersion
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
