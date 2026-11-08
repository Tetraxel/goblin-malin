import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { deleteTempFiles, isAppTempFile, planTempClear } from "#flows/musicDownloadFlow/utils/tempDownloads";
import type { ClearTempRequest } from "#base/bridges/clearTempConfirmBridge";

// "Clear temporary downloads" used to `rmSync(<configured folder>, { recursive: true })` with no confirmation, so a
// temp folder pointed at the music library wiped it. These tests pin the safe behaviour. Everything happens inside
// throw-away folders under the OS temp dir; GOBLIN_DATA_DIR is set before anything that resolves #constants loads.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-temp-test-data-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const roots: string[] = [dataDir];
function makeDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push(dir);
    return dir;
}

const UUID = "bc77579f-0b13-4cf9-9787-7a78ef8d15d6";
const tempName = (label = "YtDlp", ext = "flac") => `${label} YOUTUBE-TRACK-dlR8aLEeAr8 ${UUID}.${ext}`;
const write = (dir: string, name: string) => fs.writeFileSync(path.join(dir, name), "x");

afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

describe("isAppTempFile", () => {
    test("recognises the files the providers create, including yt-dlp leftovers", () => {
        expect(isAppTempFile(tempName())).toBe(true);
        expect(isAppTempFile(tempName("Soulseek", "mp3"))).toBe(true);
        expect(isAppTempFile(`YtDlp YOUTUBE-TRACK-abc ${UUID}.f251.webm.part`)).toBe(true);
        expect(isAppTempFile(`YtDlp YOUTUBE-TRACK-abc ${UUID}.webm.ytdl`)).toBe(true);
    });

    test("does not recognise anybody else's files", () => {
        expect(isAppTempFile("Daft Punk - Technologic.flac")).toBe(false);
        expect(isAppTempFile("01 Intro.mp3")).toBe(false);
        expect(isAppTempFile("notes.txt")).toBe(false);
        expect(isAppTempFile(`${UUID}.flac`)).toBe(false); // no leading name + space
        expect(isAppTempFile(`photo${UUID}.jpg`)).toBe(false);
    });
});

describe("planTempClear", () => {
    test("refuses an empty, relative or root folder", () => {
        expect(planTempClear("", [])).toMatchObject({ ok: false });
        expect(planTempClear("   ", [])).toMatchObject({ ok: false });
        expect(planTempClear("tmp", [])).toMatchObject({ ok: false });
        expect(planTempClear(path.parse(os.tmpdir()).root, [])).toMatchObject({ ok: false });
    });

    test("refuses a temp folder that is the output folder", () => {
        const library = makeDir("goblin-temp-test-lib-");
        write(library, tempName());
        const plan = planTempClear(library, [{ label: "output folder", path: library }]);
        expect(plan).toMatchObject({ ok: false });
        expect(!plan.ok && plan.reason).toMatch(/output folder/);
        expect(fs.existsSync(path.join(library, tempName()))).toBe(true);
    });

    test("refuses a temp folder that contains the output folder or the home folder", () => {
        const parent = makeDir("goblin-temp-test-parent-");
        const library = path.join(parent, "Music");
        fs.mkdirSync(library);
        expect(planTempClear(parent, [{ label: "output folder", path: library }])).toMatchObject({ ok: false });
        expect(planTempClear(path.dirname(os.homedir()), [{ label: "home folder", path: os.homedir() }])).toMatchObject({
            ok: false,
        });
        expect(planTempClear(os.homedir(), [{ label: "home folder", path: os.homedir() }])).toMatchObject({ ok: false });
    });

    test("does not mistake a sibling with the same prefix for a protected folder", () => {
        const base = makeDir("goblin-temp-test-base-");
        const temp = path.join(base, "lib");
        const sibling = path.join(base, "lib-extra");
        fs.mkdirSync(temp);
        fs.mkdirSync(sibling);
        expect(planTempClear(temp, [{ label: "output folder", path: sibling }])).toMatchObject({ ok: true });
    });

    test("allows the default layout: the temp folder is a sub-folder of the output folder", () => {
        const library = makeDir("goblin-temp-test-lib-");
        const temp = path.join(library, "tmp");
        fs.mkdirSync(temp);
        write(temp, tempName());
        const plan = planTempClear(temp, [{ label: "output folder", path: library }]);
        expect(plan).toMatchObject({ ok: true });
        expect(plan.ok && plan.files).toHaveLength(1);
    });

    test("lists only the app's own temp files, never foreign files or sub-folders", () => {
        const temp = makeDir("goblin-temp-test-tmp-");
        write(temp, tempName());
        write(temp, tempName("Soulseek", "mp3"));
        write(temp, "my-favourite-song.flac");
        fs.mkdirSync(path.join(temp, "Some Album"));
        write(path.join(temp, "Some Album"), tempName());
        const plan = planTempClear(temp, []);
        expect(plan.ok && plan.files.map((f) => path.basename(f.path)).sort()).toEqual(
            [tempName(), tempName("Soulseek", "mp3")].sort()
        );
    });

    test("a folder that does not exist yet has nothing to clear", () => {
        const temp = path.join(makeDir("goblin-temp-test-none-"), "not-created");
        expect(planTempClear(temp, [])).toEqual({ ok: true, dir: temp, files: [] });
    });
});

describe("deleteTempFiles", () => {
    test("removes the planned files and leaves everything else, folder included", () => {
        const temp = makeDir("goblin-temp-test-del-");
        write(temp, tempName());
        write(temp, "keep-me.flac");
        const plan = planTempClear(temp, []);
        if (!plan.ok) throw new Error("plan refused");
        expect(deleteTempFiles(plan)).toMatchObject({ removed: 1, failed: 0 });
        expect(fs.readdirSync(temp)).toEqual(["keep-me.flac"]);
    });
});

describe("clearTempDownloads (settings action)", () => {
    type Mods = {
        clear: typeof import("#flows/musicDownloadFlow/saveSettings").clearTempDownloads;
        bridge: typeof import("#base/bridges/clearTempConfirmBridge").clearTempConfirmBridge;
        settings: import("#settings/settingsStore").SettingsStore;
    };
    let m: Mods;

    beforeAll(async () => {
        m = {
            clear: (await import("#flows/musicDownloadFlow/saveSettings")).clearTempDownloads,
            bridge: (await import("#base/bridges/clearTempConfirmBridge")).clearTempConfirmBridge,
            settings: (await import("#settings/settingsStore")).SettingsStore.getInstance(),
        };
    });
    afterEach(() => m.bridge.setOpener(null));

    function configure(outputDir: string, tempDir: string) {
        m.settings.writeMusicSettings({ download: { outputDir, outputTemporaryDir: tempDir } });
    }
    function answer(choice: "proceed" | "cancel") {
        const seen: ClearTempRequest[] = [];
        m.bridge.setOpener((req) => {
            seen.push(req);
            if (req.kind === "confirm") (choice === "proceed" ? req.proceed : req.cancel)();
            else req.close();
        });
        return seen;
    }

    test("deletes only the app's temp files after the user confirms", async () => {
        const output = makeDir("goblin-temp-test-out-");
        const temp = path.join(output, "tmp");
        fs.mkdirSync(temp);
        write(temp, tempName());
        write(temp, "someone-elses.flac");
        configure(output, temp);
        const seen = answer("proceed");

        expect(await m.clear()).toBe("cleared");
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ kind: "confirm", fileCount: 1 });
        expect(fs.readdirSync(temp)).toEqual(["someone-elses.flac"]);
    });

    test("deletes nothing when the user says no", async () => {
        const output = makeDir("goblin-temp-test-out-");
        const temp = path.join(output, "tmp");
        fs.mkdirSync(temp);
        write(temp, tempName());
        configure(output, temp);
        answer("cancel");

        expect(await m.clear()).toBe("cancelled");
        expect(fs.existsSync(path.join(temp, tempName()))).toBe(true);
    });

    test("deletes nothing when no UI is there to ask", async () => {
        const output = makeDir("goblin-temp-test-out-");
        const temp = path.join(output, "tmp");
        fs.mkdirSync(temp);
        write(temp, tempName());
        configure(output, temp);

        expect(await m.clear()).toBe("cancelled");
        expect(fs.existsSync(path.join(temp, tempName()))).toBe(true);
    });

    test("refuses, explains and keeps the library when the temp folder is the output folder", async () => {
        const library = makeDir("goblin-temp-test-lib-");
        write(library, "my-favourite-song.flac");
        write(library, tempName());
        fs.mkdirSync(path.join(library, "Some Album"));
        write(path.join(library, "Some Album"), "01 track.flac");
        configure(library, library);
        const seen = answer("proceed");

        expect(await m.clear()).toBe("refused");
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ kind: "refused" });
        expect(fs.readdirSync(library).sort()).toEqual(["Some Album", "my-favourite-song.flac", tempName()].sort());
    });

    test("reports when there is nothing to clear", async () => {
        const output = makeDir("goblin-temp-test-out-");
        const temp = path.join(output, "tmp");
        fs.mkdirSync(temp);
        configure(output, temp);
        const seen = answer("proceed");

        expect(await m.clear()).toBe("nothing");
        expect(seen).toHaveLength(0);
    });
});
