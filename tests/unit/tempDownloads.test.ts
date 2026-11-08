import { afterAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    checkTempFolder,
    deleteTempGroups,
    isAppTempFile,
    scanTempGroups,
    tempFileStem,
} from "#flows/musicDownloadFlow/utils/tempDownloads";

// "Clear temporary downloads" used to `rmSync(<configured folder>, { recursive: true })` with no confirmation, so a
// temp folder pointed at the music library wiped it. These tests pin the safe behaviour of the folder layer: what
// counts as one of the app's files, which folders are refused, and that only the app's files are ever listed or
// deleted. Everything happens inside throw-away folders under the OS temp dir.
const roots: string[] = [];
function makeDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push(dir);
    return dir;
}

const UUID = "bc77579f-0b13-4cf9-9787-7a78ef8d15d6";
const OTHER_UUID = "11111111-2222-3333-4444-555555555555";
const tempName = (label = "YtDlp", ext = "flac", uuid = UUID) => `${label} YOUTUBE-TRACK-dlR8aLEeAr8 ${uuid}.${ext}`;
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

describe("tempFileStem", () => {
    test("a download and its leftovers share one stem, whatever the extension", () => {
        const stem = tempFileStem(tempName());
        expect(stem).toBe(`ytdlp youtube-track-dlr8aleear8 ${UUID}`);
        expect(tempFileStem(tempName("YtDlp", "webm"))).toBe(stem);
        expect(tempFileStem(`YtDlp YOUTUBE-TRACK-dlR8aLEeAr8 ${UUID}.f251.webm.part`)).toBe(stem);
        expect(tempFileStem(tempName("YtDlp", "flac", OTHER_UUID))).not.toBe(stem);
    });

    test("works on a full path (either separator) and ignores case", () => {
        const name = tempName();
        expect(tempFileStem(path.join("C:", "tmp", name))).toBe(tempFileStem(name));
        expect(tempFileStem(`/home/me/tmp/${name}`)).toBe(tempFileStem(name));
        expect(tempFileStem(name.toUpperCase())).toBe(tempFileStem(name));
    });

    test("is null for anything that is not the app's", () => {
        expect(tempFileStem("my-favourite-song.flac")).toBeNull();
        expect(tempFileStem(path.join(os.homedir(), "Music", "Daft Punk - Technologic.flac"))).toBeNull();
    });
});

describe("checkTempFolder", () => {
    test("refuses an empty, relative or root folder", () => {
        expect(checkTempFolder("", [])).toMatchObject({ ok: false });
        expect(checkTempFolder("   ", [])).toMatchObject({ ok: false });
        expect(checkTempFolder("tmp", [])).toMatchObject({ ok: false });
        expect(checkTempFolder(path.parse(os.tmpdir()).root, [])).toMatchObject({ ok: false });
    });

    test("refuses a temp folder that is the output folder", () => {
        const library = makeDir("goblin-temp-test-lib-");
        const check = checkTempFolder(library, [{ label: "output folder", path: library }]);
        expect(check).toMatchObject({ ok: false });
        expect(!check.ok && check.reason).toMatch(/output folder/);
    });

    test("refuses a temp folder that contains the output folder or the home folder", () => {
        const parent = makeDir("goblin-temp-test-parent-");
        const library = path.join(parent, "Music");
        fs.mkdirSync(library);
        expect(checkTempFolder(parent, [{ label: "output folder", path: library }])).toMatchObject({ ok: false });
        expect(
            checkTempFolder(path.dirname(os.homedir()), [{ label: "home folder", path: os.homedir() }])
        ).toMatchObject({ ok: false });
        expect(checkTempFolder(os.homedir(), [{ label: "home folder", path: os.homedir() }])).toMatchObject({
            ok: false,
        });
    });

    test("does not mistake a sibling with the same prefix for a protected folder", () => {
        const base = makeDir("goblin-temp-test-base-");
        const temp = path.join(base, "lib");
        const sibling = path.join(base, "lib-extra");
        fs.mkdirSync(temp);
        fs.mkdirSync(sibling);
        expect(checkTempFolder(temp, [{ label: "output folder", path: sibling }])).toMatchObject({ ok: true });
    });

    test("allows the default layout: the temp folder is a sub-folder of the output folder", () => {
        const library = makeDir("goblin-temp-test-lib-");
        const temp = path.join(library, "tmp");
        fs.mkdirSync(temp);
        expect(checkTempFolder(temp, [{ label: "output folder", path: library }])).toMatchObject({ ok: true });
    });
});

describe("scanTempGroups", () => {
    test("lists only the app's own temp files, never foreign files or sub-folders", async () => {
        const temp = makeDir("goblin-temp-test-tmp-");
        write(temp, tempName());
        write(temp, tempName("Soulseek", "mp3"));
        write(temp, "my-favourite-song.flac");
        fs.mkdirSync(path.join(temp, "Some Album"));
        write(path.join(temp, "Some Album"), tempName());
        const groups = await scanTempGroups(temp);
        const names = groups.flatMap((g) => g.files.map((f) => path.basename(f.path))).sort();
        expect(names).toEqual([tempName(), tempName("Soulseek", "mp3")].sort());
    });

    test("groups a download with its leftovers, summing sizes and keeping the newest write time", async () => {
        const temp = makeDir("goblin-temp-test-group-");
        write(temp, tempName());
        write(temp, `YtDlp YOUTUBE-TRACK-dlR8aLEeAr8 ${UUID}.f251.webm.part`);
        write(temp, tempName("YtDlp", "flac", OTHER_UUID));
        const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
        fs.utimesSync(path.join(temp, tempName()), old, old);

        const groups = await scanTempGroups(temp);
        expect(groups).toHaveLength(2);
        const pair = groups.find((g) => g.files.length === 2)!;
        expect(pair.bytes).toBe(2);
        // The leftover was just written: the group as a whole is "recent".
        expect(Date.now() - pair.mtimeMs).toBeLessThan(60_000);
    });

    test("a folder that does not exist yet has nothing in it", async () => {
        const temp = path.join(makeDir("goblin-temp-test-none-"), "not-created");
        expect(await scanTempGroups(temp)).toEqual([]);
    });
});

describe("deleteTempGroups", () => {
    test("removes the groups' files and leaves everything else, folder included", async () => {
        const temp = makeDir("goblin-temp-test-del-");
        write(temp, tempName());
        write(temp, `YtDlp YOUTUBE-TRACK-dlR8aLEeAr8 ${UUID}.f251.webm.part`);
        write(temp, "keep-me.flac");
        const groups = await scanTempGroups(temp);
        const progress: Array<[number, number]> = [];

        const result = await deleteTempGroups(groups, (done, total) => progress.push([done, total]));

        expect(result).toMatchObject({ removedFiles: 2, failedFiles: 0 });
        expect(result.removedStems).toEqual(new Set([tempFileStem(tempName())]));
        expect(progress).toEqual([[1, 1]]);
        expect(fs.readdirSync(temp)).toEqual(["keep-me.flac"]);
    });
});
