import fs from "fs";
import { getMusicSettings, StoredProviderSettings } from "./settings";
import { globalLogger } from "#base/logger/logger";

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

export function clearTempDownloads(): void {
    const dir = getTempDownloadDir();
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    globalLogger.info("Temporary downloads cleared");
}

export function getSaveSettings(): SaveSettings {
    const s = getMusicSettings();
    return {
        outputDir: s.download.outputDir,
        includeMusicBrainzTags: false,
    };
}
