import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { getBinDir } from "#utils/appPaths";
import { installFromZip } from "#utils/binaryArchive";
import { EXTRACT_DIR_PREFIX, installViaStaging, removeOldVersions } from "#utils/binaryFiles";
import { verifyAgainstPublishedChecksums } from "#utils/checksum";
import { downloadFile } from "#utils/http";
import { globalLogger } from "#base/logger/logger";

const execFileAsync = promisify(execFile);

/**
 * The version of uv the app downloads (https://github.com/astral-sh/uv): a single program that installs Python and
 * audio-separator into a folder of the app's own (P33). Pinned: the install flags are checked against this version.
 */
export const UV_VERSION = "0.13.9";

const USER_AGENT = "goblin-malin uv installer";

/** The release asset for this computer, or `null` where uv publishes none. */
export function uvAssetName(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | null {
    const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
    if (!cpu) return null;
    switch (platform) {
        case "win32":
            return `uv-${cpu}-pc-windows-msvc.zip`;
        case "darwin":
            return `uv-${cpu}-apple-darwin.tar.gz`;
        case "linux":
            return `uv-${cpu}-unknown-linux-gnu.tar.gz`;
        default:
            return null;
    }
}

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** Where the pinned uv lives once downloaded. */
export function uvPath(): string {
    return path.join(getBinDir(), exe(`uv_${UV_VERSION}`));
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(
        () => true,
        () => false
    );
}

let inflight: Promise<string> | undefined;

/**
 * The path of the pinned uv, downloaded first when it is not there. The archive is checked against the checksum the
 * uv project publishes next to it, and refused when that cannot be done: it is a program the app runs.
 */
export function ensureUv(): Promise<string> {
    inflight ??= setUpUv().finally(() => (inflight = undefined));
    return inflight;
}

async function setUpUv(): Promise<string> {
    const target = uvPath();
    if (await exists(target)) return target;

    const asset = uvAssetName();
    if (!asset) throw new Error(`uv publishes no build for ${process.platform} ${process.arch}`);
    const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
    await fs.mkdir(getBinDir(), { recursive: true });
    globalLogger.info(`Downloading uv ${UV_VERSION} (${asset})`);

    if (asset.endsWith(".zip")) {
        await installFromZip(
            {
                url: `${base}/${asset}`,
                // Hyphen: never taken for a cached binary ("uv_").
                tempName: "uv-download.zip",
                userAgent: USER_AGENT,
                checksumsUrl: `${base}/${asset}.sha256`,
                archiveName: asset,
                requireChecksum: true,
            },
            [{ entrySuffix: exe("uv"), destPath: target }]
        );
    } else {
        await installFromTarball(`${base}/${asset}`, `${base}/${asset}.sha256`, asset, target);
    }

    await removeOldVersions("uv_", path.basename(target));
    globalLogger.info(`uv ${UV_VERSION} installed at ${target}`);
    return target;
}

/** macOS and Linux: the release is a `.tar.gz` holding `<folder>/uv`; extracted with the system's `tar`. */
async function installFromTarball(url: string, checksumsUrl: string, asset: string, target: string): Promise<void> {
    const binDir = getBinDir();
    const archive = path.join(binDir, "uv-download.tar.gz");
    const stage = await fs.mkdtemp(path.join(binDir, EXTRACT_DIR_PREFIX));
    try {
        await downloadFile(url, archive, { userAgent: USER_AGENT });
        await verifyAgainstPublishedChecksums(archive, checksumsUrl, asset, USER_AGENT, { required: true });
        await execFileAsync("tar", ["-xzf", archive, "-C", stage]);
        const folder = asset.replace(/\.tar\.gz$/, "");
        const extracted = path.join(stage, folder, "uv");
        await installViaStaging(target, (staging) => fs.rename(extracted, staging));
    } finally {
        await fs.rm(archive, { force: true });
        await fs.rm(stage, { recursive: true, force: true });
    }
}
