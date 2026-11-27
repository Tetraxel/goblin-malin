import { type SettingsItem } from "#settings/buildSettingsItems";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { globalLogger } from "#base/logger/logger";
import { revealInFileExplorer } from "#utils/revealInFileExplorer";
import { extensionStore, type ExtensionRecord, type ExtensionState } from "./extensionStore";
import { allExtensionSettings, writeExtensionSetting } from "./api/createApi";
import { getExtensionsDir } from "./manifest";
import { askTrustFromSettings, turnOff } from "./loader";

/**
 * Settings → Extensions (P34). Like the rest of the page, what is changed here is a draft until "Save": the on/off
 * switches and the extensions' own settings. Turning on an extension that was never allowed asks first (after the
 * page closed); turning one off takes effect at the next start.
 */
export type ExtensionsDraft = {
    /** The switch of each extension the user flipped (true = on). */
    switches: Record<string, boolean>;
    /** The settings the user changed, by extension then key. */
    values: Record<string, Record<string, unknown>>;
};

export const emptyExtensionsDraft = (): ExtensionsDraft => ({ switches: {}, values: {} });

export function isExtensionsDraftDirty(draft: ExtensionsDraft): boolean {
    return Object.keys(draft.switches).length > 0 || Object.keys(draft.values).length > 0;
}

const STATE_COLORS: Record<ExtensionState, string> = {
    loaded: "#4ec27a",
    loading: "#d6b84a",
    off: "#8a8a8a",
    untrusted: "#d6b84a",
    failed: "#e05555",
    incompatible: "#e08a3c",
    invalid: "#e05555",
    disabled: "#8a8a8a",
};

/** The state as one short phrase, for the row and for `ext list`. */
export function describeState(record: ExtensionRecord): string {
    switch (record.state) {
        case "loaded":
            return record.development ? "loaded (development, --extension)" : "loaded";
        case "loading":
            return "loading…";
        case "off":
            return record.reason ? `off · ${record.reason}` : "off";
        case "untrusted":
            return record.changed ? "its files changed: waiting for your answer" : "waiting for your answer";
        case "failed":
            return `failed: ${record.reason ?? "unknown error"}`;
        case "incompatible":
            return record.reason ?? "written for another API version";
        case "invalid":
            return `cannot be read: ${record.reason ?? ""}`;
        case "disabled":
            return "off for this run (--no-extensions)";
    }
}

/** What the switch shows: the answer given this run, else whether it is loaded. */
function isOn(record: ExtensionRecord): boolean {
    return record.wantedOn ?? (record.state === "loaded" || record.state === "loading");
}

/** What each extension's `settingsStatus` answers, read in the background when Settings opens. */
export async function loadExtensionStatuses(): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    await Promise.all(
        extensionStore.list().map(async (record) => {
            if (!record.settingsStatus || record.state !== "loaded") return;
            try {
                out[record.name] = await record.settingsStatus();
            } catch (error) {
                globalLogger.warn(`Could not read the settings status of the extension ${record.name}`, { error });
            }
        })
    );
    return out;
}

function showLog(record: ExtensionRecord): void {
    const lines = [...record.log].reverse();
    void dialogBridge.choose({
        title: `${record.displayName}: latest log lines`,
        intro:
            lines.length === 0
                ? "Nothing logged yet. Every line also goes to app.log, prefixed with ext:" + record.name
                : `Newest first. Every line also goes to app.log, prefixed with ext:${record.name}.`,
        items: lines.slice(0, 200).map((l) => ({
            label: `${l.level.toUpperCase().padEnd(5)} ${l.message.split("\n")[0]}`,
            detail: [l.at, ...l.message.split("\n").slice(1, 6)],
        })),
    });
}

export function buildExtensionSettingsItems(
    draft: ExtensionsDraft,
    onChange: (next: ExtensionsDraft) => void,
    status: Record<string, string | undefined> = {}
): SettingsItem[] {
    const records = extensionStore.list();
    const items: SettingsItem[] = [{ kind: "sectionHeader", label: "Extensions" }];
    items.push({
        kind: "note",
        indent: 0,
        text: "Changes take effect at the next start. An extension runs with the app's rights: only use ones you trust.",
    });
    items.push({
        kind: "action",
        indent: 0,
        icon: "⌂",
        label: "Open the extensions folder",
        run: () => revealInFileExplorer(getExtensionsDir()),
    });
    if (records.length === 0) {
        items.push({
            kind: "note",
            indent: 0,
            text: "No extension installed. Add one with `goblin-malin ext add <folder | git URL>`, or start one with `goblin-malin ext new <name>`.",
        });
        return items;
    }

    for (const record of records) {
        const name = record.name;
        items.push({
            kind: "providerHeader",
            label: `${record.displayName}${record.version ? ` ${record.version}` : ""}`,
            color: STATE_COLORS[record.state],
        });
        if (record.description) items.push({ kind: "note", indent: 4, text: record.description });
        items.push({ kind: "readonlyText", indent: 4, label: "State", value: describeState(record) });

        const canSwitch =
            !record.development &&
            !record.shadowed &&
            record.state !== "invalid" &&
            record.state !== "incompatible" &&
            record.state !== "disabled";
        if (canSwitch) {
            items.push({
                kind: "checkbox",
                indent: 4,
                label: "On",
                get: () => draft.switches[name] ?? isOn(record),
                set: (v) => {
                    const switches = { ...draft.switches };
                    if (v === isOn(record)) delete switches[name];
                    else switches[name] = v;
                    onChange({ ...draft, switches });
                },
            });
        }

        const current = { ...allExtensionSettings(record), ...(draft.values[name] ?? {}) };
        const setValue = (key: string, value: unknown) =>
            onChange({
                ...draft,
                values: { ...draft.values, [name]: { ...(draft.values[name] ?? {}), [key]: value } },
            });
        for (const [key, def] of Object.entries(record.settings)) {
            if (def.kind === "checkbox") {
                items.push({
                    kind: "checkbox",
                    indent: 4,
                    label: def.label,
                    get: () => current[key] === true,
                    set: (v) => setValue(key, v),
                });
            } else if (def.kind === "select") {
                items.push({
                    kind: "select",
                    indent: 4,
                    label: def.label,
                    options: def.options,
                    get: () => String(current[key] ?? def.defaultValue),
                    set: (v) => setValue(key, v),
                });
            } else {
                items.push({
                    kind: "textInput",
                    indent: 4,
                    label: def.label,
                    get: () => String(current[key] ?? def.defaultValue),
                    set: (v) => setValue(key, v),
                });
            }
        }

        if (record.settingsRows && record.state === "loaded") {
            let rows: ReturnType<NonNullable<ExtensionRecord["settingsRows"]>> = [];
            try {
                rows = record.settingsRows(status[name]);
            } catch (error) {
                rows = [
                    {
                        kind: "note",
                        text: `Its settings rows failed: ${error instanceof Error ? error.message : error}`,
                    },
                ];
            }
            for (const row of rows) {
                if (row.kind === "note") items.push({ kind: "note", indent: 4, text: row.text });
                else
                    items.push({
                        kind: "action",
                        indent: 4,
                        label: row.label,
                        icon: row.icon,
                        run: () => {
                            Promise.resolve()
                                .then(() => row.run())
                                .catch((error) =>
                                    globalLogger.error(`Extension ${name}: settings action "${row.label}" failed`, {
                                        error,
                                    })
                                );
                        },
                    });
            }
        }

        const c = record.contributions;
        const added = [
            c.actions.length ? `${c.actions.length} action${c.actions.length === 1 ? "" : "s"}` : "",
            c.providers.length ? `${c.providers.length} provider${c.providers.length === 1 ? "" : "s"}` : "",
            c.tools.length ? `${c.tools.length} Claude tool${c.tools.length === 1 ? "" : "s"}` : "",
            c.events ? `${c.events} event handler${c.events === 1 ? "" : "s"}` : "",
        ].filter(Boolean);
        if (added.length > 0) items.push({ kind: "note", indent: 4, text: `Adds ${added.join(", ")}.` });

        items.push({ kind: "action", indent: 4, icon: "≡", label: "Show its log lines", run: () => showLog(record) });
        items.push({
            kind: "action",
            indent: 4,
            icon: "⌂",
            label: "Open its folder",
            run: () => revealInFileExplorer(record.folder),
        });
    }
    return items;
}

/** Saves the draft: the settings at once, the switches as answers in the trust record (an "on" asks first). */
export function commitExtensionsDraft(draft: ExtensionsDraft): void {
    for (const [name, values] of Object.entries(draft.values)) {
        const record = extensionStore.get(name);
        if (!record) continue;
        for (const [key, value] of Object.entries(values)) writeExtensionSetting(record, key, value);
    }
    for (const [name, on] of Object.entries(draft.switches)) {
        const record = extensionStore.get(name);
        if (!record) continue;
        if (on) void askTrustFromSettings(record);
        else void turnOff(record);
    }
}
