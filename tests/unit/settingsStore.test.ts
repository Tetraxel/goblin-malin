import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { dataFileNoticeBridge, type DataFileNotice } from "#base/bridges/dataFileNoticeBridge";
import { DEFAULT_APP_SETTINGS } from "#settings/appSettings";
import { SettingsStore } from "#settings/settingsStore";
import { deepDiff } from "#utils/deepDiff";
import { deepMerge } from "#utils/deepMerge";
import type { Shortcut } from "#types/actions";

let dir: string;
let file: string;
let notices: DataFileNotice[];

const onDisk = () => JSON.parse(fs.readFileSync(file, "utf-8"));
const withPrefix = (prefix: string): string[] => fs.readdirSync(dir).filter((name) => name.startsWith(prefix));
const key = (name: string): Shortcut => ({ name }) as unknown as Shortcut;

const userFile = {
    version: 2,
    general: { theme: "light" },
    logs: {},
    keybindings: { "global.tab": key("x") },
    music: { download: { outputDir: "D:/Music" } },
};

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-settings-"));
    file = path.join(dir, "settings.json");
    notices = [];
    dataFileNoticeBridge.reset();
    dataFileNoticeBridge.setOpener((n) => notices.push(n));
});

afterEach(() => {
    dataFileNoticeBridge.reset();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("SettingsStore loading", () => {
    test("a valid file is read and a missing one gives the defaults, silently", () => {
        fs.writeFileSync(file, JSON.stringify(userFile));
        expect(new SettingsStore(file).getAppSettings().general.theme).toBe("light");

        expect(new SettingsStore(path.join(dir, "nope.json")).getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
        expect(notices).toEqual([]);
    });

    test("a UTF-8 BOM is stripped, not treated as damage", () => {
        fs.writeFileSync(file, "\uFEFF" + JSON.stringify(userFile));
        const settings = new SettingsStore(file).getAppSettings();
        expect(settings.general.theme).toBe("light");
        expect(notices).toEqual([]);
    });

    test.each([
        ["truncated", JSON.stringify(userFile).slice(0, 25)],
        ["empty", ""],
        ["null", "null"],
        ["an array", "[]"],
    ])("%s: set aside untouched, the user is told, and one write doesn't lose it", (_name, content) => {
        fs.writeFileSync(file, content);
        const store = new SettingsStore(file);

        expect(store.getAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
        store.setKeybinding("global.tab", key("y")); // a normal write

        const [quarantined] = withPrefix("settings.json.corrupt-");
        expect(fs.readFileSync(path.join(dir, quarantined), "utf-8")).toBe(content);
        expect(notices).toHaveLength(1);
        expect(onDisk().keybindings).toEqual({ "global.tab": key("y") });
    });

    test("a damaged file is replaced by the copy from the previous launch: theme and keybindings survive", () => {
        fs.writeFileSync(file, JSON.stringify(userFile));
        new SettingsStore(file).setKeybinding("global.other", key("z")); // healthy launch → .bak of userFile

        fs.writeFileSync(file, '{"general":{"the');
        const store = new SettingsStore(file);

        const settings = store.getAppSettings();
        expect(settings.general.theme).toBe("light");
        expect(settings.keybindings).toEqual(userFile.keybindings);
        expect(notices).toHaveLength(1);
        expect(notices[0].message).toContain("restored");
    });

    test("a wrong-typed section is reset on its own, the rest is kept, and a copy is made", () => {
        const raw = JSON.stringify({ ...userFile, keybindings: [1, 2] });
        fs.writeFileSync(file, raw);
        const settings = new SettingsStore(file).getAppSettings();

        expect(settings.general.theme).toBe("light");
        expect(settings.keybindings).toEqual({});
        const [copy] = withPrefix("settings.json.corrupt-");
        expect(fs.readFileSync(path.join(dir, copy), "utf-8")).toBe(raw);
        expect(notices).toHaveLength(1);
    });

    test("a file from a newer version keeps its unknown keys and version, with a copy and a notice", () => {
        const raw = JSON.stringify({ ...userFile, version: 99, future: true });
        fs.writeFileSync(file, raw);
        const store = new SettingsStore(file);
        store.setKeybinding("global.other", key("z"));

        expect(fs.readFileSync(file + ".from-v99", "utf-8")).toBe(raw);
        expect(onDisk().version).toBe(99);
        expect(onDisk().future).toBe(true);
        expect(notices).toHaveLength(1);
    });

    test("a file that exists but can't be read is never overwritten", () => {
        fs.mkdirSync(file);
        const store = new SettingsStore(file);
        store.setKeybinding("global.tab", key("y"));

        expect(fs.statSync(file).isDirectory()).toBe(true);
        expect(store.getAppSettings().keybindings).toEqual({ "global.tab": key("y") }); // still works in memory
        expect(notices).toHaveLength(1);
    });
});

describe("SettingsStore migrations", () => {
    test("the pre-P20b flows shape still moves to `music`", () => {
        fs.writeFileSync(
            file,
            JSON.stringify({ general: {}, logs: {}, keybindings: {}, flows: { "music-downloader": { a: 1 } } })
        );
        expect(new SettingsStore(file).getMusicSettings({ a: 0 })).toEqual({ a: 1 });
    });

    test("an old file loses its frozen defaults and its orphan keys (the developer's real file)", () => {
        fs.writeFileSync(
            file,
            JSON.stringify({
                general: { ...DEFAULT_APP_SETTINGS.general, theme: "light" },
                logs: { ...DEFAULT_APP_SETTINGS.logs },
                keybindings: { "global.toggleProfiling": key("p"), "global.tab": key("x") },
                music: { collections: { defaultLiveRefreshIntervalMinutes: 5 } },
            })
        );
        const store = new SettingsStore(file);
        store.setKeybinding("global.other", key("z")); // any write

        const saved = onDisk();
        expect(saved.version).toBe(2);
        expect(saved.general).toEqual({ theme: "light" });
        expect(saved.logs).toEqual({});
        expect(Object.keys(saved.keybindings).sort()).toEqual(["global.other", "global.tab"]);
        // The old minutes interval isn't lost, it becomes seconds.
        expect(saved.music).toEqual({ collections: { defaultLiveRefreshIntervalSeconds: 300 } });
    });

    test("an old minutes interval does not override a seconds value that exists", () => {
        fs.writeFileSync(
            file,
            JSON.stringify({
                music: { collections: { defaultLiveRefreshIntervalMinutes: 5, defaultLiveRefreshIntervalSeconds: 30 } },
            })
        );
        const music = new SettingsStore(file).getMusicSettings({ collections: {} } as Record<string, unknown>);
        expect(music).toEqual({ collections: { defaultLiveRefreshIntervalSeconds: 30 } });
    });
});

describe("SettingsStore only stores what differs from the defaults", () => {
    test("changing one app setting writes only that setting", () => {
        const store = new SettingsStore(file);
        const current = store.getAppSettings();
        store.writeAppSettings({ ...current, general: { ...current.general, theme: "light" } });

        expect(onDisk()).toEqual({ version: 2, general: { theme: "light" }, logs: {}, keybindings: {}, music: {} });
    });

    test("a setting put back to its default leaves the file", () => {
        const store = new SettingsStore(file);
        const base = store.getAppSettings();
        store.writeAppSettings({ ...base, general: { ...base.general, theme: "light" } });
        store.writeAppSettings({ ...base, general: { ...base.general, theme: DEFAULT_APP_SETTINGS.general.theme } });

        expect(onDisk().general).toEqual({});
    });

    test("nested overrides keep only the changed leaf", () => {
        const store = new SettingsStore(file);
        const base = store.getAppSettings();
        store.writeAppSettings({
            ...base,
            general: { ...base.general, concurrency: { ...base.general.concurrency, maxParallelDownloads: 9 } },
        });

        expect(onDisk().general).toEqual({ concurrency: { maxParallelDownloads: 9 } });
        expect(store.getAppSettings().general.concurrency.maxParallelTasks).toBe(
            DEFAULT_APP_SETTINGS.general.concurrency.maxParallelTasks
        );
    });

    test("music settings saved with their defaults store only the overrides", () => {
        const defaults = {
            download: { outputDir: "A", preferLossless: false },
            metadata: { providers: { x: { enabled: true } } },
        };
        const store = new SettingsStore(file);
        store.writeMusicSettings(deepMerge(defaults, { download: { outputDir: "B" } }), defaults);

        expect(onDisk().music).toEqual({ download: { outputDir: "B" } });
        expect(store.getMusicSettings(defaults)).toEqual({
            download: { outputDir: "B", preferLossless: false },
            metadata: { providers: { x: { enabled: true } } },
        });
    });

    test("patchMusicSettings adds to the stored overrides without freezing defaults", () => {
        const store = new SettingsStore(file);
        store.patchMusicSettings({ collections: { showAccessHints: false } });
        store.patchMusicSettings({ download: { outputDir: "B" } });

        expect(onDisk().music).toEqual({ collections: { showAccessHints: false }, download: { outputDir: "B" } });
    });
});

describe("deepDiff", () => {
    test("is the inverse of deepMerge", () => {
        const defaults = { a: 1, b: { c: 2, d: [1, 2] }, e: "x" };
        const value = { a: 1, b: { c: 3, d: [1, 2, 3] }, e: "x" };
        const diff = deepDiff(defaults, value);
        expect(diff).toEqual({ b: { c: 3, d: [1, 2, 3] } });
        expect(deepMerge(defaults, diff!)).toEqual(value);
    });

    test("returns undefined when nothing differs", () => {
        expect(deepDiff({ a: { b: [1] } }, { a: { b: [1] } })).toBeUndefined();
    });
});

describe("the data folder is never stored", () => {
    test("a stored appDataDir is ignored on load and dropped on the next write", () => {
        const stale = { ...userFile, general: { theme: "light", appDataDir: "C:\\Users\\someone-else\\goblin-malin" } };
        fs.writeFileSync(file, JSON.stringify(stale));
        const store = new SettingsStore(file);

        expect(store.getAppSettings().general).not.toHaveProperty("appDataDir");
        expect(store.getAppSettings().general.theme).toBe("light");

        store.patchMusicSettings({ download: { outputDir: "B" } });
        expect(onDisk().general).toEqual({ theme: "light" });
        expect(notices).toEqual([]);
    });
});
