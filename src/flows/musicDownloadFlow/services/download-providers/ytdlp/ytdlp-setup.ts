import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import * as https from "https";
import { getBinDir } from "../../../../../utils/appPaths";
import { globalLogger } from "../../../../../base/logger/logger";

interface GitHubRelease {
    tag_name: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
}

export async function ensureYtDlpSetup(): Promise<string> {
    try {
        let latestVersion: string | null = null;

        // Try to get the latest version from GitHub
        try {
            latestVersion = await getLatestYtDlpVersion();
        } catch (error) {
            globalLogger.warn(`Failed to fetch latest yt-dlp version: ${error}`);
            globalLogger.info("Attempting to use existing binary…");
        }

        // If GitHub API failed, try to find existing binary
        if (!latestVersion) {
            throw new Error("yt-dlp release not found");
        }

        const binaryName = `yt-dlp_${latestVersion}.exe`;
        const binaryPath = path.join(getBinDir(), binaryName);

        // Check if binary exists
        try {
            await fs.access(binaryPath);
            globalLogger.info(`yt-dlp ${latestVersion} already installed at ${binaryPath}`);
            return binaryPath;
        } catch {
            globalLogger.info(`yt-dlp ${latestVersion} not found, downloading…`);
        }

        // Create bin directory if it doesn't exist
        await fs.mkdir(getBinDir(), { recursive: true });

        // Clean up old yt-dlp versions (optional)
        await cleanupOldVersions("yt-dlp_", binaryName);

        // Download the binary
        const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${latestVersion}/yt-dlp.exe`;
        await downloadFile(downloadUrl, binaryPath);

        globalLogger.info(`Successfully downloaded yt-dlp ${latestVersion} to ${binaryPath}`);
        return binaryPath;
    } catch {
        const existingBinary = await findExistingBinary("yt-dlp_", ".exe");
        if (existingBinary) {
            globalLogger.info(`Using existing yt-dlp at ${existingBinary}`);
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

        // Sort by name (which includes version) and return the most recent
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

async function getLatestYtDlpVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
        https
            .get(
                "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
                {
                    headers: {
                        "User-Agent": "Node.js yt-dlp installer",
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
                            resolve(release.tag_name);
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
