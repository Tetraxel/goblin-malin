import os from "os";
import path from "path";
import { getMusicSettings, StoredProviderSettings } from "./settings";
import { globalLogger } from "#base/logger/logger";
import { clearTempConfirmBridge } from "#base/bridges/clearTempConfirmBridge";
import { DEFAULT_APP_DATA_DIR } from "#constants";
import { getBinDir } from "#utils/appPaths";
import { deleteTempFiles, planTempClear } from "./utils/tempDownloads";

export interface SaveSettings {
    outputDir: string;
    includeMusicBrainzTags: boolean;
}

export function getDownloadDir(): string {
    return getMusicSettings().download.outputDir;
}

export function getTempDownloadDir(): string {
    return getMusicSettings().download.outputTemporaryDir;
}

/** Stored runtime settings for a download provider (keyed by its registry name). */
export function getDownloadProviderSettings(providerKey: string): StoredProviderSettings {
    return getMusicSettings().download.providers[providerKey] ?? {};
}

/** Stored runtime settings for a metadata provider (keyed by its registry name). */
export function getMetadataProviderSettings(providerKey: string): StoredProviderSettings {
    return getMusicSettings().metadata.providers[providerKey] ?? {};
}

export type ClearTempOutcome = "cleared" | "nothing" | "cancelled" | "refused";

/**
 * "Clear temporary downloads". The temporary folder is a free-text setting, so this never deletes the folder:
 * it deletes only the files the app itself created in it (recognised by name, see utils/tempDownloads.ts),
 * refuses when the folder is — or contains — the output folder, the home folder, a drive root or the app's
 * own data, and asks the user to confirm before removing anything.
 */
export async function clearTempDownloads(): Promise<ClearTempOutcome> {
    const settings = getMusicSettings();
    const plan = planTempClear(getTempDownloadDir(), [
        { label: "output folder", path: settings.download.outputDir },
        { label: "home folder", path: os.homedir() },
        { label: "app data folder", path: DEFAULT_APP_DATA_DIR },
        { label: "app data folder", path: path.dirname(getBinDir()) },
        { label: "current working directory", path: process.cwd() },
    ]);

    if (!plan.ok) {
        globalLogger.warn(`Temporary downloads were not cleared: ${plan.dir || "(no folder)"} — ${plan.reason}`);
        await clearTempConfirmBridge.refused(plan.dir, plan.reason);
        return "refused";
    }

    if (plan.files.length === 0) {
        globalLogger.info(`No temporary downloads to clear in ${plan.dir}`);
        return "nothing";
    }

    const totalBytes = plan.files.reduce((sum, file) => sum + file.bytes, 0);
    if (!(await clearTempConfirmBridge.confirm(plan.dir, plan.files.length, totalBytes))) {
        globalLogger.info("Clearing temporary downloads was cancelled");
        return "cancelled";
    }

    const { removed, failed, bytes } = deleteTempFiles(plan);
    globalLogger.info(
        `Temporary downloads cleared: ${removed} file(s), ${(bytes / (1024 * 1024)).toFixed(1)} MB` +
            (failed > 0 ? ` (${failed} could not be deleted)` : "")
    );
    return "cleared";
}

export function getSaveSettings(): SaveSettings {
    const s = getMusicSettings();
    return {
        outputDir: s.download.outputDir,
        includeMusicBrainzTags: false,
    };
}
