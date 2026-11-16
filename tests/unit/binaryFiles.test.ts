import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";

// Tools are written to a staging name and renamed once complete; the old version goes only after the new one is in.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-binfiles-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;
const { installViaStaging, removeOldVersions, stagingPathFor } = await import("#utils/binaryFiles");
const { getBinDir } = await import("#utils/appPaths");

const ext = process.platform === "win32" ? ".exe" : "";
const bin = () => getBinDir();
const names = () => fs.readdirSync(bin()).sort();

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
beforeEach(() => {
    fs.rmSync(bin(), { recursive: true, force: true });
    fs.mkdirSync(bin(), { recursive: true });
});

describe("installViaStaging", () => {
    test("the final name only ever holds the finished file", async () => {
        const finalPath = path.join(bin(), `yt-dlp_2.0${ext}`);
        await installViaStaging(finalPath, async (staging) => {
            fs.writeFileSync(staging, "half");
            // While the download is going on, nothing sits at the name the app trusts.
            expect(fs.existsSync(finalPath)).toBe(false);
            fs.appendFileSync(staging, " and the rest");
        });
        expect(fs.readFileSync(finalPath, "utf8")).toBe("half and the rest");
        expect(names()).toEqual([`yt-dlp_2.0${ext}`]);
    });

    test("a failure (bad checksum, dropped connection) leaves nothing at all, and the error is passed on", async () => {
        const finalPath = path.join(bin(), `yt-dlp_2.0${ext}`);
        await expect(
            installViaStaging(finalPath, async (staging) => {
                fs.writeFileSync(staging, "truncated");
                throw new Error("checksum mismatch");
            })
        ).rejects.toThrow("checksum mismatch");
        expect(names()).toEqual([]);
    });

    test("a download that was killed halfway is not mistaken for a tool, and is replaced by the next try", async () => {
        const finalPath = path.join(bin(), `yt-dlp_2.0${ext}`);
        // What a killed process leaves behind.
        fs.writeFileSync(stagingPathFor(finalPath), "cut off");
        expect(fs.existsSync(finalPath)).toBe(false);
        expect(names().some((n) => n.startsWith("yt-dlp_"))).toBe(false);

        await installViaStaging(finalPath, async (staging) => {
            expect(fs.existsSync(staging)).toBe(false); // the leftover was cleared first
            fs.writeFileSync(staging, "complete");
        });
        expect(fs.readFileSync(finalPath, "utf8")).toBe("complete");
    });
});

describe("removeOldVersions", () => {
    test("removes the other versions, and any unfinished download, but not the one kept", async () => {
        const keep = `yt-dlp_2.0${ext}`;
        for (const name of [`yt-dlp_1.0${ext}`, keep, `ffmpeg_1${ext}`, `.yt-dlp_0.9${ext}.part`]) {
            fs.writeFileSync(path.join(bin(), name), "x");
        }
        await removeOldVersions("yt-dlp_", keep);
        expect(names()).toEqual([`ffmpeg_1${ext}`, keep].sort());
    });

    test("keeps the download that is going on for the version being installed", async () => {
        const keep = `yt-dlp_2.0${ext}`;
        fs.writeFileSync(stagingPathFor(path.join(bin(), keep)), "in progress");
        await removeOldVersions("yt-dlp_", keep);
        expect(names()).toHaveLength(1);
    });

    test("removes the extraction folder an interrupted install left, but not one that may be in use", async () => {
        const leftover = path.join(bin(), ".extract-AbC123");
        const inUse = path.join(bin(), ".extract-XyZ789");
        for (const dir of [leftover, inUse]) {
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, `ffmpeg${ext}`), "x");
        }
        const old = new Date(Date.now() - 60 * 60_000);
        fs.utimesSync(leftover, old, old);

        await removeOldVersions("yt-dlp_", `yt-dlp_2.0${ext}`);
        expect(names()).toEqual([".extract-XyZ789"]);
    });
});

describe("the order of an update", () => {
    test("a failed install keeps the working version: the old one is removed only after the new one is in", async () => {
        const old = path.join(bin(), `yt-dlp_1.0${ext}`);
        fs.writeFileSync(old, "works");
        const next = path.join(bin(), `yt-dlp_2.0${ext}`);

        // What `setUpYtDlp` does: install first, clean up after.
        const update = async (fail: boolean) => {
            await installViaStaging(next, async (staging) => {
                fs.writeFileSync(staging, "new");
                if (fail) throw new Error("connection dropped");
            });
            await removeOldVersions("yt-dlp_", path.basename(next));
        };

        await expect(update(true)).rejects.toThrow();
        expect(fs.readFileSync(old, "utf8")).toBe("works");
        expect(names()).toEqual([path.basename(old)]);

        await update(false);
        expect(names()).toEqual([path.basename(next)]);
    });
});
