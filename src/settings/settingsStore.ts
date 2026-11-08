import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { DEFAULT_APP_DATA_DIR } from "#constants";
import { AppSettings, DEFAULT_APP_SETTINGS } from "./appSettings";
import { DeepPartial } from "#utils/types";
import { deepMerge } from "#utils/deepMerge";
import { deepDiff } from "#utils/deepDiff";
import { isPlainObject, loadDataFile, Parsed, refreshBackup, runMigrations } from "#utils/dataFile";

export const SETTINGS_PATH = path.join(DEFAULT_APP_DATA_DIR, "settings.json");

/** Bump when the stored shape changes, and add the `SETTINGS_MIGRATIONS[oldVersion]` step that upgrades a file. */
export const SETTINGS_FILE_VERSION = 2;

/**
 * Shape of the JSON file on disk. It holds only what the user changed: every section is an override layer
 * over the defaults (merged back on read), so a default changed in a later release still reaches them.
 */
type StoredSettings = {
    version: number;
    general: DeepPartial<AppSettings["general"]>;
    logs: DeepPartial<AppSettings["logs"]>;
    keybindings: AppSettings["keybindings"];
    music: Record<string, unknown>;
};

/** Pre-P20b file shape: music settings lived under flows["music-downloader"]. */
type LegacyStoredSettings = Partial<StoredSettings> & {
    flows?: Record<string, Record<string, unknown>>;
};

const SECTIONS = ["general", "logs", "keybindings", "music"] as const;

/** Shortcut ids that no longer exist: a stored override for one is dead weight. */
const REMOVED_KEYBINDINGS = ["global.toggleProfiling"];

/** `[v]` upgrades a version-`v` file to `v + 1`. Runs once on load; the result is saved on the next write. */
const SETTINGS_MIGRATIONS: Record<number, (file: StoredSettings) => StoredSettings> = {
    // v1 → v2: files used to store the whole merged `general`/`logs` (defaults frozen in), and kept keys of
    // settings that have since been renamed or removed.
    1: (file) => {
        const keybindings = { ...file.keybindings };
        for (const id of REMOVED_KEYBINDINGS) delete keybindings[id];

        const music = { ...file.music };
        const collections = music.collections;
        if (isPlainObject(collections)) {
            const { defaultLiveRefreshIntervalMinutes: minutes, ...rest } = collections;
            // The interval moved from minutes to seconds; keep a custom value if there is no new one yet.
            if (typeof minutes === "number" && rest.defaultLiveRefreshIntervalSeconds === undefined) {
                rest.defaultLiveRefreshIntervalSeconds = minutes * 60;
            }
            music.collections = rest;
        }

        const { general, logs } = DEFAULT_APP_SETTINGS;
        return {
            ...file,
            general: deepDiff(general, deepMerge(general, file.general)) ?? {},
            logs: deepDiff(logs, deepMerge(logs, file.logs)) ?? {},
            keybindings,
            music,
        };
    },
};

const emptySettings = (): StoredSettings => ({
    version: SETTINGS_FILE_VERSION,
    general: {},
    logs: {},
    keybindings: {},
    music: {},
});

const corruptSuffix = (): string => `corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;

/** Validates the shape of a parsed `settings.json`; `null` means it is not a settings file at all. */
function parseSettingsFile(raw: unknown): Parsed<StoredSettings> {
    if (!isPlainObject(raw)) return null;
    const { flows, ...rest } = raw as LegacyStoredSettings;

    // Silent migration from the pre-P20b shape; persisted on the next write.
    const sections: Record<string, unknown> = {
        ...rest,
        music: rest.music === undefined && flows ? (flows["music-downloader"] ?? {}) : rest.music,
    };

    // Every section must be an object. A wrong-typed one is replaced by an empty override layer (its content
    // stays in a copy of the file, since the next write drops it).
    const badSections: string[] = [];
    for (const key of SECTIONS) {
        if (sections[key] === undefined) {
            sections[key] = {};
        } else if (!isPlainObject(sections[key])) {
            badSections.push(key);
            sections[key] = {};
        }
    }

    // The data folder is derived from `GOBLIN_DATA_DIR`/the OS default, never stored: older files froze their
    // absolute path in here, which then pulled `cache/`, `bin/` and `app.log` away from the real folder.
    if (isPlainObject(sections.general) && "appDataDir" in sections.general) {
        const general = { ...sections.general };
        delete general.appDataDir;
        sections.general = general;
    }

    const version = typeof rest.version === "number" ? rest.version : 1;
    const file = { ...sections, version } as StoredSettings;
    const value = runMigrations(file, version, SETTINGS_FILE_VERSION, SETTINGS_MIGRATIONS);
    // A file from a newer app keeps its version (and unknown keys); only older ones are upgraded.
    if (version < SETTINGS_FILE_VERSION) value.version = SETTINGS_FILE_VERSION;

    if (version > SETTINGS_FILE_VERSION) {
        return {
            value,
            keepCopy: {
                suffix: `from-v${version}`,
                message: `Your settings were saved by a newer version of the app (file format ${version}, this version understands ${SETTINGS_FILE_VERSION}). They are loaded as-is, but anything this version doesn't know about may be lost when it saves.`,
            },
        };
    }
    if (badSections.length > 0) {
        return {
            value,
            keepCopy: {
                suffix: corruptSuffix(),
                message: `The ${badSections.join(", ")} part of your settings couldn't be read and was reset to its defaults.`,
            },
        };
    }
    return { value };
}

export class SettingsStore {
    private static instance: SettingsStore;
    private cache: StoredSettings | null = null;
    private readonly emitter = new EventEmitter();
    /** The last load found a good file, so it is worth keeping as `.bak` before the first write. */
    private loadedHealthy = false;
    /** The file exists but couldn't be read: never write over content we haven't seen. */
    private readOnly = false;
    private backedUp = false;

    constructor(private readonly filePath: string = SETTINGS_PATH) {}

    static getInstance(): SettingsStore {
        if (!SettingsStore.instance) SettingsStore.instance = new SettingsStore();
        return SettingsStore.instance;
    }

    private readFromDisk(): StoredSettings {
        const loaded = loadDataFile(this.filePath, "Your settings file", parseSettingsFile);
        this.loadedHealthy = loaded.healthy;
        this.readOnly = loaded.readOnly;
        return loaded.value ?? emptySettings();
    }

    private writeToDisk(settings: StoredSettings): void {
        // In memory first, so the app keeps working with what the user just changed even if the disk refuses.
        this.cache = settings;
        this.emitter.emit("change");
        if (this.readOnly) return;

        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        if (!this.backedUp) {
            // The file as it was at launch is the "last good copy" the next damaged load falls back on.
            this.backedUp = true;
            if (this.loadedHealthy) refreshBackup(this.filePath);
        }
        const tmp = this.filePath + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf-8");
        fs.renameSync(tmp, this.filePath);
    }

    private getCached(): StoredSettings {
        if (!this.cache) this.cache = this.readFromDisk();
        return this.cache;
    }

    // ── App (global) settings ──────────────────────────────────────────────────

    getAppSettings(): AppSettings {
        const s = this.getCached();
        return deepMerge(DEFAULT_APP_SETTINGS, {
            general: s.general,
            logs: s.logs,
            keybindings: s.keybindings ?? {},
        } as DeepPartial<AppSettings>);
    }

    writeAppSettings(settings: AppSettings): void {
        const current = this.getCached();
        // Only what differs from the defaults is stored, so a default changed later still reaches this user.
        this.writeToDisk({
            ...current,
            general: deepDiff(DEFAULT_APP_SETTINGS.general, settings.general) ?? {},
            logs: deepDiff(DEFAULT_APP_SETTINGS.logs, settings.logs) ?? {},
            keybindings: settings.keybindings ?? {},
        });
    }

    /** Save a single key binding override. */
    setKeybinding(actionId: string, shortcut: import("#types/actions").Shortcut | null): void {
        const current = this.getAppSettings();
        const keybindings = { ...current.keybindings };
        if (shortcut === null) {
            delete keybindings[actionId];
        } else {
            keybindings[actionId] = shortcut;
        }
        this.writeAppSettings({ ...current, keybindings });
    }

    // ── Music downloader settings ──────────────────────────────────────────────

    getMusicSettings<T extends Record<string, unknown>>(defaults: T): T {
        const stored = (this.getCached().music ?? {}) as DeepPartial<T>;
        return deepMerge(defaults, stored);
    }

    /**
     * Saves the music settings. Pass the `defaults` they were merged over to store only what differs from
     * them (otherwise `settings` is stored as given).
     */
    writeMusicSettings(settings: Record<string, unknown>, defaults?: Record<string, unknown>): void {
        const music = defaults ? (deepDiff(defaults, settings) ?? {}) : settings;
        this.writeToDisk({ ...this.getCached(), music });
    }

    patchMusicSettings(patch: DeepPartial<Record<string, unknown>>): void {
        this.writeMusicSettings(deepMerge(this.getMusicSettings({}), patch));
    }

    // ── Change notifications ───────────────────────────────────────────────────

    onSettingsChanged(callback: () => void): () => void {
        this.emitter.on("change", callback);
        return () => {
            this.emitter.off("change", callback);
        };
    }
}
