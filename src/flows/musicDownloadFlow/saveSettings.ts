import fs from "fs";
import { SettingsStore } from "#settings/settingsStore";
import {
    MusicDownloadFlowSettings,
    BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS,
    StoredProviderSettings,
} from "./settings";
import { globalLogger } from "#base/logger/logger";

export interface SaveSettings {
    outputDir: string;
    includeMusicBrainzTags: boolean;
}

function getFlowSettings(): MusicDownloadFlowSettings {
    return SettingsStore.getInstance().getFlowSettings<MusicDownloadFlowSettings>(
        "music-downloader",
        BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS
    );
}

export function getDownloadDir(): string {
    return getFlowSettings().download.outputDir;
}

export function getTempDownloadDir(): string {
    return getFlowSettings().download.outputTemporaryDir;
}

/** Stored runtime settings for a download provider (keyed by its registry name). */
export function getDownloadProviderSettings(providerKey: string): StoredProviderSettings {
    return getFlowSettings().download.providers[providerKey] ?? {};
}

/** Stored runtime settings for a metadata provider (keyed by its registry name). */
export function getMetadataProviderSettings(providerKey: string): StoredProviderSettings {
    return getFlowSettings().metadata.providers[providerKey] ?? {};
}

export function clearTempDownloads(): void {
    const dir = getTempDownloadDir();
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    globalLogger.info("Temporary downloads cleared");
}

export function getSaveSettings(): SaveSettings {
    const s = getFlowSettings();
    return {
        outputDir: s.download.outputDir,
        includeMusicBrainzTags: false,
    };
}
