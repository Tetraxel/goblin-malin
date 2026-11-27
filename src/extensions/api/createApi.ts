import fs from "fs/promises";
import path from "path";
import { APP_VERSION, EXTENSION_API_VERSION } from "#constants";
import { globalLogger, type Logger } from "#base/logger/logger";
import { appSecrets, wizardEnvKeys } from "#base/appSecrets";
import { actionsMenuRegistry } from "#base/actionsMenu";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { type ServiceRegistry } from "#base/service-registry";
import { readSystemClipboard, writeSystemClipboard } from "#base/systemClipboard";
import { SettingsStore } from "#settings/settingsStore";
import { getAppDataDir } from "#utils/appPaths";
import { openUrl } from "#utils/openUrl";
import { revealInFileExplorer } from "#utils/revealInFileExplorer";
import { fetchWithTimeout, PROVIDER_TIMEOUT_MS } from "#utils/timeout";
import { saveEnvVar, removeEnvVar } from "#utils/envFile";
import { MetadataService } from "#flows/musicDownloadFlow/metadataService";
import { DiscoveryMetadataService } from "#flows/musicDownloadFlow/discoveryMetadataService";
import { DownloadService } from "#flows/musicDownloadFlow/downloadService";
import { StemSeparationService } from "#flows/musicDownloadFlow/stems/stemService";
import {
    discoveryServiceRegistry,
    downloadServiceRegistry,
    metadataServiceRegistry,
    stemServiceRegistry,
} from "#flows/musicDownloadFlow/registries";
import { getMusicSettings } from "#flows/musicDownloadFlow/settings";
import { musicEvents, watchCollectionsDone, wireAppReadyEvent } from "#flows/musicDownloadFlow/appEvents";
import { extensionStore, type ExtensionRecord } from "../extensionStore";
import { checkSettingsSchema, getExtensionDataDir } from "../manifest";
import { createTasksApi } from "./tasksApi";
import { spawnForExtension } from "./processApi";
import { readAudioFile, scanAudioFolder } from "./filesApi";
import { askClaude } from "./claudeApi";
import { defineExtensionTool } from "./agentApi";
import { type ExtensionSettingsSchema, type GoblinApi, type ProviderRegistryApi } from "./types";

/** An `unavailableReason` slower than this is named in the log: it runs every time the Actions menu opens. */
const SLOW_REASON_MS = 50;

/** What every extension's secret variable starts with. */
export const EXTENSION_SECRET_PREFIX = "GOBLIN_EXT_";

/** The environment variable a secret of an extension is kept under in `.env` (`GOBLIN_EXT_LIBRARY_DEDUPE__TOKEN`). */
export function extensionSecretVar(extension: string, key: string): string {
    const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
    return `${EXTENSION_SECRET_PREFIX}${clean(extension)}__${clean(key)}`;
}

/** The variables of `.env` that belong to an extension: they leave the environment as soon as it is known. */
export function adoptExtensionSecrets(extension: string): void {
    const prefix = extensionSecretVar(extension, "");
    appSecrets.adopt(Object.keys(process.env).filter((k) => k.startsWith(prefix)));
}

/** The logger of one extension: lines prefixed with its name in the log panel and `app.log`, the latest kept for Settings. */
export function extensionLogger(name: string): Logger {
    return globalLogger.createChild({ service: `ext:${name}` });
}

function logFn(record: ExtensionRecord, logger: Logger, level: "debug" | "info" | "warn" | "error") {
    return (message: string, details?: Record<string, unknown>) => {
        const text = typeof message === "string" ? message : String(message);
        extensionStore.appendLog(record.name, { at: new Date().toISOString(), level, message: text });
        logger[level](text, details);
    };
}

/** Reads one extension setting: the stored value when it fits the declared kind, else the default. */
export function readExtensionSetting(record: ExtensionRecord, key: string): unknown {
    const stored = SettingsStore.getInstance().getExtensionSettings(record.name);
    const def = record.settings[key];
    const value = stored[key];
    if (!def) return value;
    if (def.kind === "checkbox") return typeof value === "boolean" ? value : def.defaultValue;
    if (def.kind === "select")
        return typeof value === "string" && def.options.includes(value) ? value : def.defaultValue;
    return typeof value === "string" ? value : def.defaultValue;
}

export function allExtensionSettings(record: ExtensionRecord): Record<string, unknown> {
    const stored = SettingsStore.getInstance().getExtensionSettings(record.name);
    const out: Record<string, unknown> = { ...stored };
    for (const key of Object.keys(record.settings)) out[key] = readExtensionSetting(record, key);
    return out;
}

/** Stores a value; one equal to the declared default is not stored, so a later default still reaches the user. */
export function writeExtensionSetting(record: ExtensionRecord, key: string, value: unknown): void {
    const store = SettingsStore.getInstance();
    const stored = store.getExtensionSettings(record.name);
    const def = record.settings[key];
    if (def && value === def.defaultValue) delete stored[key];
    else stored[key] = value;
    store.writeExtensionSettings(record.name, stored);
}

type AnyRegistry = ServiceRegistry<never, never>;

/**
 * Builds the `goblin` object one extension receives. Everything it registers is prefixed with its name and recorded
 * in its {@link ExtensionRecord} (Settings → Extensions lists it).
 */
export function createGoblinApi(record: ExtensionRecord): GoblinApi {
    const name = record.name;
    const logger = extensionLogger(name);
    const log = {
        debug: logFn(record, logger, "debug"),
        info: logFn(record, logger, "info"),
        warn: logFn(record, logger, "warn"),
        error: logFn(record, logger, "error"),
    };
    const dataDir = getExtensionDataDir(name);
    const contribute = (kind: keyof ExtensionRecord["contributions"], id?: string) => {
        if (kind === "events") record.contributions.events++;
        else if (id) record.contributions[kind].push(id);
        extensionStore.update(name, { contributions: record.contributions });
    };

    // ── storage ──
    const storageFile = path.join(dataDir, "storage.json");
    let storageCache: Record<string, unknown> | undefined;
    let storageWrite: Promise<void> = Promise.resolve();
    const loadStorage = async (): Promise<Record<string, unknown>> => {
        if (storageCache) return storageCache;
        try {
            const raw = JSON.parse(await fs.readFile(storageFile, "utf-8")) as unknown;
            storageCache =
                raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
        } catch {
            storageCache = {};
        }
        return storageCache;
    };
    const saveStorage = (): Promise<void> => {
        storageWrite = storageWrite.then(async () => {
            await fs.mkdir(dataDir, { recursive: true });
            const tmp = `${storageFile}.tmp`;
            await fs.writeFile(tmp, JSON.stringify(storageCache ?? {}, null, 2), "utf-8");
            await fs.rename(tmp, storageFile);
        });
        const done = storageWrite;
        storageWrite = storageWrite.catch((error) => log.error(`Could not save its storage: ${error}`));
        return done;
    };

    // ── providers ──
    const providerApi = <T>(
        registry: AnyRegistry,
        base: abstract new (...args: never[]) => unknown,
        kind: string
    ): ProviderRegistryApi<T> => ({
        register(localKey, providerClass) {
            if (typeof localKey !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(localKey)) {
                throw new Error(`${kind} provider key "${String(localKey)}" must be letters, digits, _ or -`);
            }
            if (typeof providerClass !== "function" || !(providerClass.prototype instanceof base)) {
                throw new Error(
                    `${kind} provider "${localKey}" must extend goblin.${base.name} (the class goblin gave, not a copy of your own)`
                );
            }
            const key = `${name}.${localKey}`;
            (registry as unknown as ServiceRegistry).register(key, providerClass as never);
            const wizard = (providerClass as { setupWizard?: Parameters<typeof wizardEnvKeys>[0] }).setupWizard;
            if (wizard) appSecrets.adopt(wizardEnvKeys(wizard));
            contribute("providers", `${kind}:${key}`);
            log.debug(`Registered the ${kind} provider ${key}`);
            return key;
        },
    });

    const api: GoblinApi = {
        apiVersion: EXTENSION_API_VERSION,
        version: APP_VERSION,
        extension: Object.freeze({
            name,
            displayName: record.displayName,
            version: record.version ?? "0.0.0",
            folder: record.folder,
            dataDir,
            development: record.development,
        }),
        paths: Object.freeze({
            appData: getAppDataDir(),
            outputDir: () => getMusicSettings().download.outputDir,
        }),
        log,

        settings: {
            get: <T>(key: string) => readExtensionSetting(record, key) as T,
            all: () => allExtensionSettings(record),
            set: (key, value) => writeExtensionSetting(record, key, value),
            declare: (schema: ExtensionSettingsSchema) => {
                const problem = checkSettingsSchema(schema);
                if (problem) throw new Error(`settings.declare: ${problem}`);
                record.settings = { ...record.settings, ...schema };
                extensionStore.update(name, { settings: record.settings });
            },
            onChange: (listener) => {
                let last = JSON.stringify(allExtensionSettings(record));
                return SettingsStore.getInstance().onSettingsChanged(() => {
                    const all = allExtensionSettings(record);
                    const now = JSON.stringify(all);
                    if (now === last) return;
                    last = now;
                    try {
                        listener(all);
                    } catch (error) {
                        log.error(
                            `Its settings.onChange handler failed: ${error instanceof Error ? error.message : error}`
                        );
                    }
                });
            },
            rows: (build) => extensionStore.update(name, { settingsRows: build }),
            status: (read) => extensionStore.update(name, { settingsStatus: read }),
        },

        secrets: {
            get: (key) => appSecrets.get(extensionSecretVar(name, key)),
            set: (key, value) => {
                const variable = extensionSecretVar(name, key);
                appSecrets.set(variable, value);
                void saveEnvVar(variable, value).catch((error) => log.error(`Could not save a secret: ${error}`));
            },
            delete: (key) => {
                const variable = extensionSecretVar(name, key);
                appSecrets.delete(variable);
                void removeEnvVar(variable).catch((error) => log.error(`Could not remove a secret: ${error}`));
            },
        },

        storage: {
            get: async <T>(key: string) => (await loadStorage())[key] as T | undefined,
            set: async (key, value) => {
                const all = await loadStorage();
                all[key] = structuredClone(value);
                await saveStorage();
            },
            delete: async (key) => {
                const all = await loadStorage();
                delete all[key];
                await saveStorage();
            },
        },

        actions: {
            register: (action) => {
                if (!action || typeof action.id !== "string" || typeof action.run !== "function") {
                    throw new Error("actions.register needs an id and a run function");
                }
                const id = `${name}.${action.id}`;
                const reason = action.unavailableReason;
                actionsMenuRegistry.register({
                    id,
                    label: String(action.label ?? action.id),
                    description: String(action.description ?? ""),
                    unavailableReason: reason
                        ? () => {
                              const started = performance.now();
                              try {
                                  return reason();
                              } catch (error) {
                                  return `This extension failed: ${error instanceof Error ? error.message : error}`;
                              } finally {
                                  const ms = performance.now() - started;
                                  if (ms > SLOW_REASON_MS) {
                                      log.warn(
                                          `"${action.label}": unavailableReason took ${Math.round(ms)} ms (keep it under ${SLOW_REASON_MS} ms)`
                                      );
                                  }
                              }
                          }
                        : undefined,
                    run: async () => {
                        try {
                            await action.run();
                        } catch (error) {
                            log.error(`"${action.label}" failed: ${error instanceof Error ? error.message : error}`, {
                                error,
                            });
                        }
                    },
                });
                if (!record.contributions.actions.includes(id)) contribute("actions", id);
            },
        },

        dialog: {
            confirm: (dialog, options) => dialogBridge.confirm(dialog, options),
            choose: (dialog) => dialogBridge.choose(dialog),
            input: (dialog) => dialogBridge.input(dialog),
            matrix: (dialog) => dialogBridge.matrix(dialog),
            notify: async (title, message) => {
                await dialogBridge.confirm({ title, message, choices: [{ label: "OK", tone: "primary" }] });
            },
        },

        tasks: createTasksApi(record.displayName),

        on: (event, handler, options) => {
            if (event === "collection.done") watchCollectionsDone();
            if (event === "app.ready") wireAppReadyEvent();
            const off = musicEvents.on(event, handler as never, { owner: name, timeoutMs: options?.timeoutMs });
            contribute("events");
            return off;
        },

        spawn: (command, args, options) => spawnForExtension(command, args, options),

        fetch: (url, init = {}) => {
            const { timeoutMs, ...rest } = init;
            return fetchWithTimeout(timeoutMs ?? PROVIDER_TIMEOUT_MS)(url, rest);
        },

        files: {
            readTags: (filePath) => readAudioFile(filePath, { probeDuration: true }),
            scanAudio: (folder, options) => scanAudioFolder(folder, options),
        },

        clipboard: {
            read: () => readSystemClipboard(),
            write: (text) => writeSystemClipboard(text),
        },

        open: (url) => openUrl(url),
        reveal: (filePath) => revealInFileExplorer(filePath),

        claude: {
            ask: (prompt, options = {}) => askClaude(prompt, options, logger),
        },

        agent: {
            defineTool: (tool) => {
                const toolName = defineExtensionTool(name, record.displayName, tool);
                contribute("tools", toolName);
                return toolName;
            },
        },

        providers: {
            metadata: providerApi(metadataServiceRegistry as unknown as AnyRegistry, MetadataService, "metadata"),
            discovery: providerApi(
                discoveryServiceRegistry as unknown as AnyRegistry,
                DiscoveryMetadataService,
                "discovery"
            ),
            download: providerApi(downloadServiceRegistry as unknown as AnyRegistry, DownloadService, "download"),
            stems: providerApi(stemServiceRegistry as unknown as AnyRegistry, StemSeparationService, "stems"),
            keyOf: (localKey) => `${name}.${localKey}`,
        },

        MetadataService: MetadataService as GoblinApi["MetadataService"],
        DiscoveryMetadataService: DiscoveryMetadataService as GoblinApi["DiscoveryMetadataService"],
        DownloadService: DownloadService as GoblinApi["DownloadService"],
        StemSeparationService: StemSeparationService as GoblinApi["StemSeparationService"],
    };
    return Object.freeze(api);
}
