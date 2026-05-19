import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import * as https from "https";
import { spawn } from "child_process";
import { getBinDir } from "./appPaths";
import { globalLogger } from "#base/logger/logger";

// Windows-only auto-download.
// Linux / macOS: install mpv via your package manager (brew, apt, etc.)
// and it will be picked up from PATH automatically.

interface GitHubRelease {
    tag_name: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
    }>;
}

function archName(): "x86_64" | "i686" | "aarch64" {
    switch (process.arch) {
        case "ia32":
            return "i686";
        case "arm64":
            return "aarch64";
        default:
            return "x86_64";
    }
}

/**
 * Returns the path to the mpv binary to use.
 * On Windows: downloads from shinchiro/mpv-winbuild-cmake if not already present.
 * On other platforms: returns "mpv" (system PATH).
 */
export async function ensureMpv(): Promise<string> {
    if (process.platform !== "win32") {
        return "mpv";
    }

    try {
        // Fast path: already downloaded
        const existing = await findExistingBinary("mpv_", ".exe");
        if (existing) {
            globalLogger.info(`mpv found at ${existing}`);
            return existing;
        }

        let release: GitHubRelease | null = null;
        try {
            release = await getLatestRelease();
        } catch (err) {
            globalLogger.warn(`Failed to fetch latest mpv release: ${err}`);
        }

        if (!release) {
            globalLogger.info("No mpv release fetched, falling back to system mpv");
            return "mpv";
        }

        const version = release.tag_name; // e.g. "20260421"
        const binaryName = `mpv_${version}.exe`;
        const binaryPath = path.join(getBinDir(), binaryName);

        try {
            await fs.access(binaryPath);
            globalLogger.info(`mpv ${version} already at ${binaryPath}`);
            return binaryPath;
        } catch {
            globalLogger.info(`Downloading mpv ${version}...`);
        }

        await fs.mkdir(getBinDir(), { recursive: true });
        await cleanupOldVersions("mpv_", binaryName);

        const arch = archName();
        const asset = release.assets.find(
            (a) =>
                a.name.startsWith(`mpv-${arch}-`) &&
                !a.name.includes("-dev-") &&
                !a.name.includes("-debug-") &&
                !a.name.includes("-v3-") &&
                a.name.endsWith(".7z")
        );
        if (!asset) throw new Error(`No mpv asset found for arch ${arch}`);

        const archivePath = path.join(getBinDir(), asset.name);
        globalLogger.info(`Downloading ${asset.name}...`);
        await downloadFile(asset.browser_download_url, archivePath);

        globalLogger.info("Extracting mpv.exe...");
        await extract7z(archivePath, getBinDir(), "mpv.exe");

        await fs.rename(path.join(getBinDir(), "mpv.exe"), binaryPath);
        await fs.unlink(archivePath);

        globalLogger.info(`mpv ${version} installed at ${binaryPath}`);
        return binaryPath;
    } catch (err) {
        // Last-resort: if a previous version is sitting in getBinDir(), use it
        const fallback = await findExistingBinary("mpv_", ".exe");
        if (fallback) {
            globalLogger.warn(`mpv setup encountered an error — using ${fallback}`);
            return fallback;
        }
        globalLogger.error(`mpv setup failed: ${err}. Falling back to system PATH.`);
        return "mpv";
    }
}

// ── GitHub API ───────────────────────────────────────────────────────────

async function getLatestRelease(): Promise<GitHubRelease> {
    return new Promise((resolve, reject) => {
        https
            .get(
                "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest",
                { headers: { "User-Agent": "Node.js mpv installer" } },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => (data += chunk));
                    res.on("end", () => {
                        try {
                            resolve(JSON.parse(data) as GitHubRelease);
                        } catch (e) {
                            reject(new Error(`Failed to parse GitHub response: ${e}`));
                        }
                    });
                }
            )
            .on("error", (e) => reject(new Error(`GitHub API request failed: ${e}`)));
    });
}

// ── 7z extraction (via bundled 7zip-bin) ────────────────────────────────

async function extract7z(archivePath: string, destDir: string, fileFilter?: string): Promise<void> {
    // Dynamic import keeps this Windows-only code from loading on non-Windows
    const { path7za } = await import("7zip-bin");
    return new Promise((resolve, reject) => {
        // 'e' = extract flat (no subdirs), '-y' = yes to all prompts
        const args = ["e", archivePath, `-o${destDir}`, "-y"];
        if (fileFilter) args.push(fileFilter);
        const proc = spawn(path7za, args, { stdio: "ignore" });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`7za exited with code ${code}`));
        });
        proc.on("error", reject);
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function findExistingBinary(prefix: string, suffix: string): Promise<string | null> {
    try {
        const files = await fs.readdir(getBinDir());
        const matches = files
            .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
            .sort()
            .reverse();
        if (!matches.length) return null;
        const p = path.join(getBinDir(), matches[0]);
        await fs.access(p);
        return p;
    } catch {
        return null;
    }
}

async function cleanupOldVersions(prefix: string, currentName: string): Promise<void> {
    try {
        const files = await fs.readdir(getBinDir());
        for (const f of files) {
            if (f.startsWith(prefix) && f.endsWith(".exe") && f !== currentName) {
                await fs.unlink(path.join(getBinDir(), f));
                globalLogger.info(`Removed old mpv binary: ${f}`);
            }
        }
    } catch {
        /* ignore */
    }
}

async function downloadFile(url: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    if (res.headers.location) {
                        downloadFile(res.headers.location, destination).then(resolve).catch(reject);
                        return;
                    }
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} downloading mpv`));
                    return;
                }
                const ws = createWriteStream(destination);
                res.pipe(ws);
                ws.on("finish", () => ws.close(() => resolve()));
                ws.on("error", (e) => {
                    fs.unlink(destination).catch(() => {});
                    reject(e);
                });
            })
            .on("error", reject);
    });
}
