import * as fs from "fs/promises";
import * as path from "path";
import { getBinDir } from "./appPaths";
import { globalLogger } from "#base/logger/logger";

// Executable suffix for locally-stored binaries: ".exe" on Windows, none elsewhere.
const binExt = (): string => (process.platform === "win32" ? ".exe" : "");

/**
 * The newest cached copy of a tool: the file of the bin folder that starts with `prefix` (`<tool>_`) and ends with
 * `suffix`, the last one by name (the name holds the version or the date). `null` when there is none.
 */
export async function findExistingBinary(prefix: string, suffix: string): Promise<string | null> {
    try {
        const files = await fs.readdir(getBinDir());
        const binaries = files.filter((file) => file.startsWith(prefix) && file.endsWith(suffix));
        if (binaries.length === 0) return null;

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

/**
 * Where a binary is written while it is being downloaded. It starts with a dot, so it can never be mistaken for a
 * cached tool (those start with `<tool>_`): a download that was cut short, by a kill or a closed terminal, leaves a
 * file the app never runs.
 */
export function stagingPathFor(finalPath: string): string {
    return path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.part`);
}

/**
 * Installs a tool under `finalPath` in one step: `produce` writes (and checks) the file at a staging path, which is
 * then made executable and renamed. The final name therefore only ever holds a complete, verified file. Nothing is
 * left behind on failure.
 */
export async function installViaStaging(
    finalPath: string,
    produce: (stagingPath: string) => Promise<void>
): Promise<void> {
    const staging = stagingPathFor(finalPath);
    await fs.rm(staging, { force: true });
    try {
        await produce(staging);
        // On non-Windows platforms a downloaded binary is not executable by default.
        if (process.platform !== "win32") await fs.chmod(staging, 0o755);
        await fs.rename(staging, finalPath);
    } catch (error) {
        await fs.rm(staging, { force: true }).catch(() => {});
        throw error;
    }
}

/** The folders an archive is extracted into before the executable is renamed into place (`binaryArchive.ts`). */
export const EXTRACT_DIR_PREFIX = ".extract-";
/** An extraction folder older than this is a leftover of a kill or a crash: an extraction takes seconds. */
const EXTRACT_DIR_STALE_MS = 30 * 60_000;

/**
 * Deletes the extraction folders that an interrupted install left behind (each holds a whole executable, ~130 MB). Only
 * old ones: another install, ffmpeg's next to ffprobe's, can be extracting into its own right now.
 */
async function removeStaleExtractions(): Promise<void> {
    const binDir = getBinDir();
    for (const name of await fs.readdir(binDir).catch(() => [] as string[])) {
        if (!name.startsWith(EXTRACT_DIR_PREFIX)) continue;
        const dir = path.join(binDir, name);
        try {
            const { mtimeMs } = await fs.stat(dir);
            if (Date.now() - mtimeMs < EXTRACT_DIR_STALE_MS) continue;
            await fs.rm(dir, { recursive: true, force: true });
            globalLogger.info(`Cleaned up an interrupted extraction: ${name}`);
        } catch (error) {
            globalLogger.warn(`Could not remove ${name}: ${error}`);
        }
    }
}

/**
 * Deletes the versions of a tool other than `keepName` (and any download that was never finished). Call it only once
 * the new version is in place: the old one is what the app falls back to when an update fails. A file that cannot
 * be deleted (a running executable on Windows) is skipped, and the others are still removed.
 */
export async function removeOldVersions(prefix: string, keepName: string): Promise<void> {
    await removeStaleExtractions();
    let files: string[];
    try {
        files = await fs.readdir(getBinDir());
    } catch (error) {
        globalLogger.warn(`Failed to clean up old versions of ${prefix}: ${error}`);
        return;
    }
    const keepStaging = path.basename(stagingPathFor(path.join(getBinDir(), keepName)));
    const old = files.filter(
        (file) =>
            (file.startsWith(prefix) && file.endsWith(binExt()) && file !== keepName) ||
            (file.startsWith(`.${prefix}`) && file.endsWith(".part") && file !== keepStaging)
    );
    for (const file of old) {
        try {
            await fs.unlink(path.join(getBinDir(), file));
            globalLogger.info(`Cleaned up old version: ${file}`);
        } catch (error) {
            globalLogger.warn(`Could not remove ${file}: ${error}`);
        }
    }
}
