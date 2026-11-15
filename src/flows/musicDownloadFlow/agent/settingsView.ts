import { APP_VERSION } from "#constants";
import { SettingsStore } from "#settings/settingsStore";
import { getMusicSettings } from "../settings";
import { maskPersonal } from "./views";

/** Settings that hold a secret: never shown, whatever they are called in a provider's own schema. */
const SECRET_KEY = /secret|password|passwd|token|api[-_]?key|credential|cookie|session/i;

/** The values as the app uses them, with what must not leave the computer replaced. */
function redact(value: unknown, key = ""): unknown {
    if (SECRET_KEY.test(key) && typeof value === "string" && value !== "") return "<hidden>";
    if (typeof value === "string") return maskPersonal(value);
    if (Array.isArray(value)) return value.map((v) => redact(v, key));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
    }
    return value;
}

/** The sections `get_settings` can return. */
export function settingsSections(): string[] {
    return Object.keys(allSettings());
}

function allSettings(): Record<string, unknown> {
    const app = SettingsStore.getInstance().getAppSettings();
    const music: Record<string, unknown> = { ...(getMusicSettings() as unknown as Record<string, unknown>) };
    // Not the key bindings (noise), nor the widths of the list's columns.
    delete music.ui;
    return { general: app.general, logs: app.logs, ...music };
}

/**
 * The settings in force now (the defaults with the user's changes on top): what a track will be tagged with, which
 * providers run, where files go, how many downloads run at once… for working out why something behaves oddly.
 */
export function describeSettings(section?: string): Record<string, unknown> | undefined {
    const settings = allSettings();
    const body =
        section === undefined
            ? settings
            : settings[section] === undefined
              ? undefined
              : { [section]: settings[section] };
    if (!body) return undefined;
    return {
        app: { version: APP_VERSION, platform: process.platform },
        settings: redact(body),
    };
}
