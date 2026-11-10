import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { stagingPathFor, writeViaStaging } from "#flows/musicDownloadFlow/utils/writeViaStaging";

describe("writeViaStaging", () => {
    let dir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-staging-"));
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test("the staging file sits beside the destination and keeps its extension", () => {
        const staging = stagingPathFor(path.join(dir, "A - B.flac"));
        expect(path.dirname(staging)).toBe(dir);
        expect(path.extname(staging)).toBe(".flac");
        expect(staging).not.toBe(path.join(dir, "A - B.flac"));
    });

    test("a finished build replaces the existing file and leaves no staging file", async () => {
        const dest = path.join(dir, "replace.flac");
        fs.writeFileSync(dest, "old");

        await writeViaStaging(dest, async (staging) => {
            fs.writeFileSync(staging, "new");
        });

        expect(fs.readFileSync(dest, "utf8")).toBe("new");
        expect(fs.existsSync(stagingPathFor(dest))).toBe(false);
    });

    test("a build that fails (copy stops, tagging throws) keeps the file being replaced intact", async () => {
        const dest = path.join(dir, "keep.flac");
        fs.writeFileSync(dest, "the user's file");

        await expect(
            writeViaStaging(dest, async (staging) => {
                fs.writeFileSync(staging, "half");
                throw new Error("tagging failed");
            })
        ).rejects.toThrow("tagging failed");

        expect(fs.readFileSync(dest, "utf8")).toBe("the user's file");
        expect(fs.existsSync(stagingPathFor(dest))).toBe(false);
    });

    test("a failed build for a new file leaves nothing behind", async () => {
        const dest = path.join(dir, "fresh.flac");

        await expect(
            writeViaStaging(dest, async (staging) => {
                fs.writeFileSync(staging, "half");
                throw new Error("copy stopped");
            })
        ).rejects.toThrow("copy stopped");

        expect(fs.readdirSync(dir).filter((f) => f.startsWith("fresh"))).toEqual([]);
    });
});
