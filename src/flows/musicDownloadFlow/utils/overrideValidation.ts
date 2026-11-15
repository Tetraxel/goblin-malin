import { type MetadataOverrides, type StandardArtist } from "#flows/musicDownloadFlow/types";

/**
 * The checks every edit of a track's metadata goes through, whoever makes it: the Metadata panel (a user typing in
 * a field) and the agent's `set_metadata_override`. One set of rules, so "the same validation as a user edit" is true.
 */

/** An edit was refused because a value is not acceptable. The message says which and why, for the person or the model. */
export class OverrideValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OverrideValidationError";
    }
}

export type OverrideCheck = { ok: true; value: MetadataOverrides } | { ok: false; error: string };

const MAX_TEXT = 300;
const MAX_ITEMS = 30;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, label: string, max = MAX_TEXT): string | { error: string } {
    if (typeof v !== "string") return { error: `${label} must be text` };
    const t = v.trim();
    if (t === "") return { error: `${label} cannot be empty (clear the override instead)` };
    if (t.length > max) return { error: `${label} is too long (${max} characters at most)` };
    // A control character in a title ends up in a file name and in a tag.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(t)) return { error: `${label} has a control character` };
    return t;
}

function integer(v: unknown, label: string, min: number, max: number): number | { error: string } {
    if (typeof v !== "number" || !Number.isInteger(v)) return { error: `${label} must be a whole number` };
    if (v < min || v > max) return { error: `${label} must be between ${min} and ${max}` };
    return v;
}

export type ValidateOptions = {
    /**
     * A person may blank a tag on purpose (an empty ISRC, no genres): the sources' value is then not used. The agent
     * may not: it clears the override instead (`null`), which gives the sources' value back.
     */
    allowBlank?: boolean;
};

/** Fields where a person may leave the value empty. The title is not one: it becomes the file name. */
const BLANKABLE = new Set(["isrc", "key", "artists", "genres"]);

const isBlank = (v: unknown): boolean =>
    (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

const failed = (r: unknown): r is { error: string } => isObject(r) && typeof r.error === "string";

/**
 * Checks (and tidies: trimmed text, an upper-case ISRC without dashes) a whole set of overrides. Unknown fields are
 * refused rather than stored: whatever lands in `metadataOverride` ends up in the saved file's tags.
 */
export function validateMetadataOverride(input: unknown, options: ValidateOptions = {}): OverrideCheck {
    if (!isObject(input)) return { ok: false, error: "The overrides must be an object" };
    const out: MetadataOverrides = {};

    for (const [key, raw] of Object.entries(input)) {
        if (raw === undefined) continue;
        if (options.allowBlank && BLANKABLE.has(key) && isBlank(raw)) {
            (out as Record<string, unknown>)[key] = Array.isArray(raw) ? [] : "";
            continue;
        }
        switch (key) {
            case "trackName": {
                const v = text(raw, "The title");
                if (failed(v)) return { ok: false, error: v.error };
                out.trackName = v;
                break;
            }
            case "artists": {
                if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) {
                    return { ok: false, error: `The artists must be a list of 1 to ${MAX_ITEMS} names` };
                }
                const artists: StandardArtist[] = [];
                for (const item of raw) {
                    // The panel stores artist objects; the agent sends plain names.
                    const name = text(isObject(item) ? item.name : item, "An artist name", 200);
                    if (failed(name)) return { ok: false, error: name.error };
                    artists.push(
                        isObject(item) ? { ...(item as unknown as StandardArtist), name } : { type: "artist", name }
                    );
                }
                out.artists = artists;
                break;
            }
            case "duration": {
                const v = integer(raw, "The duration (in milliseconds)", 1000, 36_000_000);
                if (failed(v)) return { ok: false, error: v.error };
                out.duration = v;
                break;
            }
            case "isrc": {
                const v = text(raw, "The ISRC", 20);
                if (failed(v)) return { ok: false, error: v.error };
                const isrc = v.replace(/[\s-]/g, "").toUpperCase();
                if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) {
                    return { ok: false, error: "The ISRC must be 12 characters like FRT092400049" };
                }
                out.isrc = isrc;
                break;
            }
            case "year": {
                const v = integer(raw, "The year", 1000, 2200);
                if (failed(v)) return { ok: false, error: v.error };
                out.year = v;
                break;
            }
            case "trackNumber": {
                const v = integer(raw, "The track number", 1, 999);
                if (failed(v)) return { ok: false, error: v.error };
                out.trackNumber = v;
                break;
            }
            case "bpm": {
                const v = integer(raw, "The BPM", 1, 400);
                if (failed(v)) return { ok: false, error: v.error };
                out.bpm = v;
                break;
            }
            case "key": {
                const v = text(raw, "The key", 20);
                if (failed(v)) return { ok: false, error: v.error };
                out.key = v;
                break;
            }
            case "genres": {
                if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) {
                    return { ok: false, error: `The genres must be a list of 1 to ${MAX_ITEMS} names` };
                }
                const genres: string[] = [];
                for (const g of raw) {
                    const v = text(g, "A genre", 60);
                    if (failed(v)) return { ok: false, error: v.error };
                    genres.push(v);
                }
                out.genres = genres;
                break;
            }
            case "album": {
                // No screen sets it, but an older session may carry one: keep it if it is a real album.
                if (!isObject(raw) || typeof raw.albumName !== "string" || typeof raw.id !== "string") {
                    return { ok: false, error: "The album override is not a valid album" };
                }
                out.album = raw as unknown as MetadataOverrides["album"];
                break;
            }
            default:
                return { ok: false, error: `"${key}" is not a field that can be overridden` };
        }
    }
    return { ok: true, value: out };
}

/**
 * Checks a change from `current` overrides to `next`: only the fields that differ are validated, so an override an
 * older version stored (before these checks existed) cannot make an unrelated edit fail. Returns the new overrides.
 */
export function checkOverrideChange(
    current: MetadataOverrides,
    next: unknown,
    options: ValidateOptions = {}
): OverrideCheck {
    if (!isObject(next)) return { ok: false, error: "The overrides must be an object" };
    const now = current as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next)) {
        if (value === undefined) continue;
        (JSON.stringify(value) === JSON.stringify(now[key]) ? kept : changed)[key] = value;
    }
    const check = validateMetadataOverride(changed, options);
    if (!check.ok) return check;
    return { ok: true, value: { ...kept, ...check.value } as MetadataOverrides };
}

/** Fields an override can set, for the agent's input schema and its description. */
export const OVERRIDE_FIELDS = [
    "trackName",
    "artists",
    "duration",
    "isrc",
    "year",
    "trackNumber",
    "bpm",
    "key",
    "genres",
] as const;
