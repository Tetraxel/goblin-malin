import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { DEFAULT_APP_DATA_DIR } from "#constants";
import { AppSettings, DEFAULT_APP_SETTINGS } from "./appSettings";
import { DeepPartial } from "#utils/types";
import { deepMerge } from "#utils/deepMerge";

export const SETTINGS_PATH = path.join(DEFAULT_APP_DATA_DIR, "settings.json");

/** Shape of the full JSON file on disk. */
type StoredSettings = {
    general: AppSettings["general"];
    logs: AppSettings["logs"];
    keybindings: AppSettings["keybindings"];
    music: Record<string, unknown>;
};

/** Pre-P20b file shape: music settings lived under flows["music-downloader"]. */
type LegacyStoredSettings = StoredSettings & {
    flows?: Record<string, Record<string, unknown>>;
};

export class SettingsStore {
    private static instance: SettingsStore;
    private cache: StoredSettings | null = null;
    private readonly emitter = new EventEmitter();

    static getInstance(): SettingsStore {
        if (!SettingsStore.instance) SettingsStore.instance = new SettingsStore();
        return SettingsStore.instance;
    }

    private readFromDisk(): StoredSettings {
        try {
            const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
            const parsed = JSON.parse(raw) as LegacyStoredSettings;
            // Silent migration from the pre-P20b shape; persisted on the next write.
            if (parsed.music === undefined && parsed.flows) {
                parsed.music = parsed.flows["music-downloader"] ?? {};
            }
            delete parsed.flows;
            return { ...parsed, music: parsed.music ?? {} };
        } catch {
            return {
                general: DEFAULT_APP_SETTINGS.general,
                logs: DEFAULT_APP_SETTINGS.logs,
                keybindings: {},
                music: {},
            };
        }
    }

    private writeToDisk(settings: StoredSettings): void {
        fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
        const tmp = SETTINGS_PATH + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf-8");
        fs.renameSync(tmp, SETTINGS_PATH);
        this.cache = settings;
        this.emitter.emit("change");
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
        this.writeToDisk({
            ...current,
            general: settings.general,
            logs: settings.logs,
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

    writeMusicSettings(settings: Record<string, unknown>): void {
        this.writeToDisk({ ...this.getCached(), music: settings });
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
