import { getMusicSettings, type StoredProviderSettings } from "./settings";

export interface SaveSettings {
    outputDir: string;
    includeMusicBrainzTags: boolean;
    /** See `MusicDownloadFlowSettings.download.convertAudio`. */
    convertAudio: boolean;
    /** See `MusicDownloadFlowSettings.download.convertFormat`. */
    convertFormat: string;
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

export function getSaveSettings(): SaveSettings {
    const s = getMusicSettings();
    return {
        outputDir: s.download.outputDir,
        includeMusicBrainzTags: false,
        convertAudio: s.download.convertAudio,
        convertFormat: s.download.convertFormat,
    };
}
