import { type ExtensionSettingsSchema, type ProviderSettingsRow } from "./api/types";

/**
 * Every extension the app found at start-up (P34), what became of it, and what it added. Read by Settings →
 * Extensions, the crash report and the log; written by the loader and by each extension's `goblin` object.
 */
export type ExtensionState =
    /** Activated. */
    | "loaded"
    /** Being activated. */
    | "loading"
    /** Switched off by the user. */
    | "off"
    /** Waiting for the user to allow it (first time, or its files changed). */
    | "untrusted"
    /** Its `activate` threw, timed out, or its entry could not be imported. */
    | "failed"
    /** Written for another API version. */
    | "incompatible"
    /** Its manifest could not be read. */
    | "invalid"
    /** Every extension is off for this run (`--no-extensions`). */
    | "disabled";

export type ExtensionLogLine = { at: string; level: "debug" | "info" | "warn" | "error"; message: string };

export type ExtensionRecord = {
    /** The manifest's name, or the folder's name when the manifest could not be read. */
    name: string;
    displayName: string;
    version?: string;
    description?: string;
    apiVersion?: number;
    folder: string;
    entry?: string;
    /** An installed copy that an `--extension` copy of the same name replaces for this run: its switch is not offered. */
    shadowed?: boolean;
    /** Loaded with `--extension` (no trust record, never saved). */
    development: boolean;
    state: ExtensionState;
    /** Why it failed, or why it is not loaded. */
    reason?: string;
    /** The files changed since the user allowed it (the reason it is asked about again). */
    changed?: boolean;
    /** The answer given during this run (the switch in Settings, a trust dialog); it applies fully at the next start. */
    wantedOn?: boolean;
    /** The hash of its files, once computed. */
    hash?: string;
    /** Settings it declares (manifest + `goblin.settings.declare`). */
    settings: ExtensionSettingsSchema;
    settingsRows?: (status: string | undefined) => ProviderSettingsRow[];
    settingsStatus?: () => Promise<string | undefined>;
    /** What it registered, by kind (full ids / keys). */
    contributions: { actions: string[]; providers: string[]; tools: string[]; events: number };
    /** Its latest log lines (at most {@link MAX_LOG_LINES}). */
    log: ExtensionLogLine[];
    /** Called when the app closes. */
    dispose?: () => void | Promise<void>;
    loadedInMs?: number;
};

export const MAX_LOG_LINES = 300;

class ExtensionStore {
    private records = new Map<string, ExtensionRecord>();
    private listeners = new Set<() => void>();

    list(): ExtensionRecord[] {
        return [...this.records.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    get(name: string): ExtensionRecord | undefined {
        return this.records.get(name);
    }

    has(name: string): boolean {
        return this.records.has(name);
    }

    add(record: ExtensionRecord): void {
        this.records.set(record.name, record);
        this.notify();
    }

    update(name: string, patch: Partial<ExtensionRecord>): void {
        const record = this.records.get(name);
        if (!record) return;
        Object.assign(record, patch);
        this.notify();
    }

    appendLog(name: string, line: ExtensionLogLine): void {
        const record = this.records.get(name);
        if (!record) return;
        record.log.push(line);
        if (record.log.length > MAX_LOG_LINES) record.log.splice(0, record.log.length - MAX_LOG_LINES);
    }

    /** Called after any change (state, contributions). Returns the function that stops it. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** One line per loaded extension, for a crash report or the log ("library-dedupe 1.0.0"). */
    describeLoaded(): string[] {
        return this.list()
            .filter((r) => r.state === "loaded")
            .map((r) => `${r.name} ${r.version ?? "?"}${r.development ? " (development)" : ""}`);
    }

    /** Tests. */
    clear(): void {
        this.records.clear();
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                /* a listener's problem is not the store's */
            }
        }
    }
}

export const extensionStore = new ExtensionStore();

/** A record for something found on disk, before anything is known of it. */
export function newRecord(
    fields: Pick<ExtensionRecord, "name" | "folder" | "development" | "state"> & Partial<ExtensionRecord>
): ExtensionRecord {
    return {
        displayName: fields.name,
        settings: {},
        contributions: { actions: [], providers: [], tools: [], events: 0 },
        log: [],
        ...fields,
    };
}
