import path from "path";
import { type ExtensionManifest, type ExtensionSettingDef, type ExtensionSettingsSchema } from "./api/types";
import { getAppDataDir } from "#utils/appPaths";

/** Where the user's extensions live: one folder each, holding an `extension.json`. */
export function getExtensionsDir(): string {
    return path.join(getAppDataDir(), "extensions");
}

/** A folder of the extension's own for what it keeps (`goblin.storage`, files it writes). */
export function getExtensionDataDir(name: string): string {
    return path.join(getAppDataDir(), "extension-data", name);
}

/** The trust record: which extension the user allowed, and the hash of its files when they did. */
export function getTrustFilePath(): string {
    return path.join(getAppDataDir(), "extensions.json");
}

export const MANIFEST_FILE = "extension.json";
export const NAME_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export type ManifestCheck =
    | { ok: true; manifest: Required<Pick<ExtensionManifest, "entry" | "displayName">> & ExtensionManifest }
    | { ok: false; error: string };

function checkSetting(key: string, def: unknown): string | undefined {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) return `setting "${key}": the key must be letters, digits or _`;
    if (!def || typeof def !== "object") return `setting "${key}" is not an object`;
    const d = def as Partial<ExtensionSettingDef> & { options?: unknown };
    if (typeof d.label !== "string" || d.label.trim() === "") return `setting "${key}" has no label`;
    if (d.kind === "checkbox")
        return typeof d.defaultValue === "boolean" ? undefined : `setting "${key}": defaultValue must be true or false`;
    if (d.kind === "textInput")
        return typeof d.defaultValue === "string" ? undefined : `setting "${key}": defaultValue must be text`;
    if (d.kind === "select") {
        if (!Array.isArray(d.options) || d.options.length === 0 || d.options.some((o) => typeof o !== "string")) {
            return `setting "${key}": options must be a list of text`;
        }
        return typeof d.defaultValue === "string" && d.options.includes(d.defaultValue)
            ? undefined
            : `setting "${key}": defaultValue must be one of its options`;
    }
    return `setting "${key}": kind must be checkbox, textInput or select`;
}

/** Checks a settings schema (the manifest's, or one declared from `activate`). Returns the first problem. */
export function checkSettingsSchema(schema: unknown): string | undefined {
    if (schema === undefined) return undefined;
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "settings must be an object";
    for (const [key, def] of Object.entries(schema)) {
        const problem = checkSetting(key, def);
        if (problem) return problem;
    }
    return undefined;
}

/**
 * Validates a parsed `extension.json` found in `folder`. Everything an extension declares is checked here, before a
 * line of its code runs: a manifest that fails never loads.
 */
export function checkManifest(raw: unknown, folder: string): ManifestCheck {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return { ok: false, error: `${MANIFEST_FILE} is not a JSON object` };
    const m = raw as Record<string, unknown>;
    if (typeof m.name !== "string" || !NAME_PATTERN.test(m.name)) {
        return { ok: false, error: `"name" must be 2–40 lower case letters, digits or dashes, starting with a letter` };
    }
    if (typeof m.version !== "string" || !VERSION_PATTERN.test(m.version)) {
        return { ok: false, error: `"version" must be a version number like 1.0.0` };
    }
    if (typeof m.apiVersion !== "number" || !Number.isInteger(m.apiVersion) || m.apiVersion < 1) {
        return { ok: false, error: `"apiVersion" must be a whole number (the API version it was written for)` };
    }
    const entry = m.entry === undefined ? "index.js" : m.entry;
    if (typeof entry !== "string" || entry.trim() === "") return { ok: false, error: `"entry" must be a file name` };
    const resolved = path.resolve(folder, entry);
    const root = path.resolve(folder) + path.sep;
    if (!resolved.startsWith(root)) return { ok: false, error: `"entry" must be inside the extension's folder` };
    for (const field of ["displayName", "description", "author", "homepage"] as const) {
        if (m[field] !== undefined && typeof m[field] !== "string")
            return { ok: false, error: `"${field}" must be text` };
    }
    const settingsProblem = checkSettingsSchema(m.settings);
    if (settingsProblem) return { ok: false, error: settingsProblem };
    return {
        ok: true,
        manifest: {
            name: m.name,
            displayName: (typeof m.displayName === "string" && m.displayName.trim()) || m.name,
            version: m.version,
            apiVersion: m.apiVersion,
            entry,
            description: m.description as string | undefined,
            author: m.author as string | undefined,
            homepage: m.homepage as string | undefined,
            settings: m.settings as ExtensionSettingsSchema | undefined,
        },
    };
}

/** An extension's name as part of a tool name (`library_dedupe`). */
export function toolPrefix(name: string): string {
    return name.replace(/-/g, "_");
}
