import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Used when a scenario names no `dataDir`: a blank, offline slate (no tutorial, no update check). */
export const DEFAULT_FIXTURE = "scripts/tui-test/fixtures/empty";

/**
 * Things in a data folder that are runtime leftovers, not fixture content: tool downloads, logs, the instance
 * lock, `.bak` copies of `settings.json`/`sessions.json`, quarantined files, half-written temp files.
 */
const RUNTIME_LEFTOVER = /^(bin|app\.pid\.lock)$|\.(log|bak|lock|tmp)$|\.corrupt-/i;

export interface IsolatedDataDir {
    /** The throwaway data folder: pass it to the app as `GOBLIN_DATA_DIR`. */
    dir: string;
    /** Deletes it (best effort: Windows may still hold a file for a moment after the app exits). */
    dispose(): void;
}

/**
 * Copies a fixture into a fresh temp folder so a scenario never reads or writes the fixture itself, the
 * developer's real data folder or the real music library: the app rewrites `sessions.json`/`settings.json`
 * (timestamps, `.bak` files, a pressed toggle) and scans the temporary-downloads folder at start-up.
 *
 * The copy's music folders are pointed inside the copy too, because the defaults live under `~/Music`, and a
 * "temporary downloads are piling up" dialog built from the real folder covers the screen mid-scenario.
 */
export function createIsolatedDataDir(fixtureDir: string, settingsPatch?: Json): IsolatedDataDir {
    if (!fs.existsSync(fixtureDir)) throw new Error(`Fixture data folder not found: ${fixtureDir}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-tui-"));
    copyFixture(fixtureDir, dir);

    const outputDir = path.join(dir, "output");
    const outputTemporaryDir = path.join(dir, "tmp");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(outputTemporaryDir, { recursive: true });
    pointMusicFoldersInside(path.join(dir, "settings.json"), outputDir, outputTemporaryDir, settingsPatch);

    return {
        dir,
        dispose: () => {
            try {
                fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            } catch {
                /* a leftover temp folder is harmless */
            }
        },
    };
}

function copyFixture(from: string, to: string): void {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (RUNTIME_LEFTOVER.test(entry.name)) continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(target, { recursive: true });
            copyFixture(source, target);
        } else if (entry.isFile()) {
            fs.copyFileSync(source, target);
        }
    }
}

export type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** `parent[key]` as an object, created when missing. */
function child(parent: Json, key: string): Json {
    const existing = parent[key];
    if (isObject(existing)) return existing;
    const created: Json = {};
    parent[key] = created;
    return created;
}

/** Deep-merges `patch` into `target` (objects merge, anything else is replaced). */
function mergeInto(target: Json, patch: Json): void {
    for (const [key, value] of Object.entries(patch)) {
        if (isObject(value)) mergeInto(child(target, key), value);
        else target[key] = value;
    }
}

/** Settings live under `music` (current) or `flows["music-downloader"]` (the pre-P20b shape some fixtures keep). */
function pointMusicFoldersInside(
    settingsPath: string,
    outputDir: string,
    outputTemporaryDir: string,
    settingsPatch?: Json
): void {
    let raw: Json = {};
    if (fs.existsSync(settingsPath)) {
        const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath, "utf-8").replace(/^\uFEFF/, ""));
        if (isObject(parsed)) raw = parsed;
    }

    const legacy =
        isObject(raw.flows) && isObject(raw.flows["music-downloader"]) ? raw.flows["music-downloader"] : undefined;
    const music = isObject(raw.music) ? raw.music : (legacy ?? child(raw, "music"));
    const download = child(music, "download");

    download.outputDir = outputDir;
    download.outputTemporaryDir = outputTemporaryDir;
    if (settingsPatch) mergeInto(raw, settingsPatch);
    fs.writeFileSync(settingsPath, JSON.stringify(raw, null, 4));
}
