import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { copyCookiesForRun } from "#flows/musicDownloadFlow/services/download-providers/ytdlp/cookiesCopy";

describe("copyCookiesForRun", () => {
    let dir: string;
    let source: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cookies-test-"));
        source = path.join(dir, "cookies.txt");
        fs.writeFileSync(source, "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n");
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test("each run gets its own copy with the same content", async () => {
        const a = await copyCookiesForRun(source);
        const b = await copyCookiesForRun(source);
        try {
            expect(a.path).not.toBe(b.path);
            expect(a.path).not.toBe(source);
            expect(fs.readFileSync(a.path, "utf8")).toBe(fs.readFileSync(source, "utf8"));
        } finally {
            await a.cleanup();
            await b.cleanup();
        }
    });

    test("what yt-dlp does to its copy never reaches the original", async () => {
        const copy = await copyCookiesForRun(source);
        const original = fs.readFileSync(source, "utf8");
        fs.writeFileSync(copy.path, "rewritten by yt-dlp");
        await copy.cleanup();
        expect(fs.readFileSync(source, "utf8")).toBe(original);
    });

    test("cleanup removes the copy and its folder, and can be called twice", async () => {
        const copy = await copyCookiesForRun(source);
        await copy.cleanup();
        expect(fs.existsSync(copy.path)).toBe(false);
        expect(fs.existsSync(path.dirname(copy.path))).toBe(false);
        await expect(copy.cleanup()).resolves.toBeUndefined();
    });

    test("a missing source throws and leaves no folder behind", async () => {
        const before = fs
            .readdirSync(os.tmpdir())
            .filter((f) => f.startsWith("goblin-cookies-") && !f.includes("test"));
        await expect(copyCookiesForRun(path.join(dir, "missing.txt"))).rejects.toThrow();
        const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("goblin-cookies-") && !f.includes("test"));
        expect(after.length).toBe(before.length);
    });
});
