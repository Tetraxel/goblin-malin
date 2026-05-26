import * as os from "os";
import * as path from "path";
import { ServiceRegistry } from "#base/service-registry";

/** Per-provider runtime values (stored in JSON). Keys match ProviderSettingsSchema fields. */
export type StoredProviderSettings = Record<string, boolean | string>;

export type MusicDownloadFlowSettings = {
    metadata: {
        autoFetchOnImport: boolean;
        autoChooseBestSource: boolean;
        providers: Record<string, StoredProviderSettings>;
        discoveryProviders: Record<string, StoredProviderSettings>;
    };
    download: {
        autoChooseBestSource: boolean;
        autoSaveToOutputDir: boolean;
        autoDeleteTempAfter24h: boolean;
        autoRelocateMissingFiles: boolean;
        outputDir: string;
        outputTemporaryDir: string;
        providers: Record<string, StoredProviderSettings>;
    };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractProviderDefaults(registry: ServiceRegistry<any, any>): Record<string, StoredProviderSettings> {
    const result: Record<string, StoredProviderSettings> = {};
    for (const key of registry.getFactories().keys()) {
        const schema = registry.getConstructor(key)?.defaultSettings;
        result[key] = schema
            ? (Object.fromEntries(
                  Object.entries(schema).map(([k, v]) => [k, v.defaultValue])
              ) as StoredProviderSettings)
            : { enabled: true };
    }
    return result;
}

const MEDIA_OUTPUT_DIR = path.join(os.homedir(), "Music", "GoblinMalin");

/** Flow-level defaults (without provider contributions — those come from registered services). */
export const BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS: MusicDownloadFlowSettings = {
    metadata: {
        autoFetchOnImport: false,
        autoChooseBestSource: false,
        providers: {},
        discoveryProviders: {},
    },
    download: {
        autoChooseBestSource: false,
        autoSaveToOutputDir: true,
        autoDeleteTempAfter24h: false,
        autoRelocateMissingFiles: false,
        outputDir: MEDIA_OUTPUT_DIR,
        outputTemporaryDir: path.join(MEDIA_OUTPUT_DIR, "tmp"),
        providers: {},
    },
};
