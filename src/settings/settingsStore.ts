import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { PROJECT_ROOT } from "../constants";
import { AppSettings, DEFAULT_APP_SETTINGS } from "./appSettings";
import { DeepPartial } from "../utils/types";
import { deepMerge } from "../utils/deepMerge";

const CONFIG_DIR = path.join(PROJECT_ROOT, "config");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");

/** Shape of the full JSON file on disk. */
type StoredSettings = {
    general: AppSettings["general"];
    flows: Record<string, Record<string, unknown>>;
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
            return JSON.parse(raw) as StoredSettings;
        } catch {
            return { general: DEFAULT_APP_SETTINGS.general, flows: {} };
        }
    }

    private writeToDisk(settings: StoredSettings): void {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
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
        return deepMerge(DEFAULT_APP_SETTINGS, { general: s.general } as DeepPartial<AppSettings>);
    }

    writeAppSettings(settings: AppSettings): void {
        const current = this.getCached();
        this.writeToDisk({ ...current, general: settings.general });
    }

    // ── Flow settings ──────────────────────────────────────────────────────────

    getFlowSettings<T extends Record<string, unknown>>(flowId: string, defaults: T): T {
        const stored = (this.getCached().flows?.[flowId] ?? {}) as DeepPartial<T>;
        return deepMerge(defaults, stored);
    }

    writeFlowSettings(flowId: string, settings: Record<string, unknown>): void {
        const current = this.getCached();
        this.writeToDisk({
            ...current,
            flows: { ...(current.flows ?? {}), [flowId]: settings },
        });
    }

    patchFlowSettings(flowId: string, patch: DeepPartial<Record<string, unknown>>): void {
        const current = this.getFlowSettings<Record<string, unknown>>(flowId, {});
        this.writeFlowSettings(flowId, deepMerge(current, patch));
    }

    // ── Change notifications ───────────────────────────────────────────────────

    onSettingsChanged(callback: () => void): () => void {
        this.emitter.on("change", callback);
        return () => {
            this.emitter.off("change", callback);
        };
    }
}
