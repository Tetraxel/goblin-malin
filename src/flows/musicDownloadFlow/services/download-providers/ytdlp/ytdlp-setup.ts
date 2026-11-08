import * as fs from "fs/promises";
import * as path from "path";
import { getBinDir } from "#utils/appPaths";
import { verifyAgainstPublishedChecksums } from "#utils/checksum";
import { downloadFile, httpsGetJson } from "#utils/http";
import { withBinaryAlert } from "#utils/withBinaryAlert";
import { globalLogger } from "#base/logger/logger";

// Executable suffix for locally-stored binaries: ".exe" on Windows, none elsewhere.
function binExt(): string {
    return process.platform === "win32" ? ".exe" : "";
}

// The yt-dlp GitHub release asset to download for the current platform. The macOS
// and Linux assets are standalone PyInstaller builds and need no Python runtime.
function ytDlpAssetName(): string {
    switch (process.platform) {
        case "win32":
            return "yt-dlp.exe";
        case "darwin":
            return "yt-dlp_macos";
        default:
            return "yt-dlp";
    }
}

/**
 * Ensure a yt-dlp binary is available and return its path.
 *
 * @param autoDownloadBinary When `true` (default), always check GitHub for the
 *   latest release and download it if missing. When `false`, reuse any existing
 *   binary without checking for updates — a download only happens when no binary
 *   exists at all (initialization), never just to update.
 */
export function ensureYtDlpSetup(autoDownloadBinary = true): Promise<string> {
    return withBinaryAlert(
        "yt-dlp",
        "yt-dlp fetches the audio from YouTube, so downloads from it fail until it is available.",
        () => setUpYtDlp(autoDownloadBinary)
    );
}

async function setUpYtDlp(autoDownloadBinary: boolean): Promise<string> {
    // Updates disabled: reuse an existing binary and skip the latest-version
    // check entirely. Fall through to the normal download only if none exists.
    if (!autoDownloadBinary) {
        const existingBinary = await findExistingBinary("yt-dlp_", binExt());
        if (existingBinary) {
            globalLogger.info(`Auto-download disabled; using existing yt-dlp at ${existingBinary}`);
            return existingBinary;
        }
        globalLogger.info("Auto-download disabled, but no yt-dlp binary found; downloading latest…");
    }

    try {
        // A failure here is handled by the catch below, which falls back to a binary downloaded earlier.
        const latestVersion = await getLatestYtDlpVersion();

        const binaryName = `yt-dlp_${latestVersion}${binExt()}`;
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
        const releaseUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${latestVersion}`;
        await downloadFile(`${releaseUrl}/${ytDlpAssetName()}`, binaryPath);
        // The release publishes SHA2-256SUMS. A missing list only logs a warning; a mismatch deletes the file and fails.
        await verifyAgainstPublishedChecksums(
            binaryPath,
            `${releaseUrl}/SHA2-256SUMS`,
            ytDlpAssetName(),
            "Node.js yt-dlp installer"
        );

        // On non-Windows platforms the downloaded binary is not executable by default.
        if (process.platform !== "win32") {
            await fs.chmod(binaryPath, 0o755);
        }

        globalLogger.info(`Successfully downloaded yt-dlp ${latestVersion} to ${binaryPath}`);
        return binaryPath;
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        // Say why, even when we then fall back to an older copy: this used to be swallowed without a trace.
        globalLogger.warn(`yt-dlp setup failed: ${cause}`);
        const existingBinary = await findExistingBinary("yt-dlp_", binExt());
        if (existingBinary) {
            globalLogger.info(`Using existing yt-dlp at ${existingBinary}`);
            return existingBinary;
        }
        throw new Error(`Could not download yt-dlp (${cause}) and no downloaded copy exists in ${getBinDir()}.`);
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
    const apiUrl = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
    const release = await httpsGetJson<{ tag_name?: string }>(apiUrl, { userAgent: "Node.js yt-dlp installer" });
    if (!release.tag_name) {
        throw new Error(`Unexpected release metadata from ${apiUrl} (no tag_name)`);
    }
    return release.tag_name;
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
