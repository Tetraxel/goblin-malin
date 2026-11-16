import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { sanitizeFileNamePart } from "#flows/musicDownloadFlow/utils/fileName";
import { cleanOutputFilename } from "#flows/musicDownloadFlow/utils/cleanOutputDir";
import {
    acquireDestinationLock,
    stagingPathFor,
    writeViaStaging,
} from "#flows/musicDownloadFlow/utils/writeViaStaging";

describe("file names that are safe on any OS", () => {
    test.each(["NUL", "con", "Aux", "PRN", "COM1", "lpt9", "nul.txt"])(
        "the device name %j gets a `_` in front",
        (name) => {
            expect(sanitizeFileNamePart(name)).toBe(`_${name}`);
        }
    );

    test("a name that only starts like a device name is left alone", () => {
        for (const name of ["Console", "Nullify", "COM10", "Communion", "auxiliary"]) {
            expect(sanitizeFileNamePart(name)).toBe(name);
        }
    });

    test("the output file of a device name is no device", () => {
        expect(cleanOutputFilename("NUL")).toBe("_NUL.flac");
        expect(cleanOutputFilename("C:\\Music\\COM1.flac")).toBe("_COM1.flac");
    });

    test("the right-to-left override and other bidirectional controls are dropped", () => {
        expect(sanitizeFileNamePart("song\u202Egpj.exe")).toBe("songgpj.exe");
        expect(sanitizeFileNamePart("a\u2066b\u2069c")).toBe("abc");
    });

    test("an accent has one spelling (NFC)", () => {
        const decomposed = "Cafe\u0301";
        expect(sanitizeFileNamePart(decomposed)).toBe("Caf\u00e9");
    });
});

describe("saving to one destination", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-dest-"));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("two saves never share a staging file", () => {
        const dest = path.join(dir, "A - B.flac");
        expect(stagingPathFor(dest)).not.toBe(stagingPathFor(dest));
        expect(path.extname(stagingPathFor(dest))).toBe(".flac");
    });

    test("a file under the old fixed staging name is not touched", async () => {
        const dest = path.join(dir, "Song.flac");
        const users = path.join(dir, "Song.saving.flac");
        fs.writeFileSync(users, "the user's own file");
        await writeViaStaging(dest, async (staging) => {
            fs.writeFileSync(staging, "new");
        });
        expect(fs.readFileSync(users, "utf8")).toBe("the user's own file");
        expect(fs.readFileSync(dest, "utf8")).toBe("new");
    });

    test("the second save waits for the first, and sees the file it made", async () => {
        const dest = path.join(dir, "Same.flac");
        const events: string[] = [];

        const save = async (who: string, hold: number) => {
            const release = await acquireDestinationLock(dest);
            try {
                events.push(`${who} checks: ${fs.existsSync(dest) ? "taken" : "free"}`);
                await new Promise((resolve) => setTimeout(resolve, hold));
                fs.writeFileSync(dest, who);
            } finally {
                release();
            }
        };

        await Promise.all([save("first", 30), save("second", 0)]);
        expect(events).toEqual(["first checks: free", "second checks: taken"]);
    });

    test("another destination does not wait", async () => {
        const release = await acquireDestinationLock(path.join(dir, "One.flac"));
        const other = await Promise.race([
            acquireDestinationLock(path.join(dir, "Two.flac")).then((r) => {
                r();
                return "got it";
            }),
            new Promise((resolve) => setTimeout(() => resolve("waited"), 100)),
        ]);
        release();
        expect(other).toBe("got it");
    });

    test("a save that fails still lets the next one in", async () => {
        const dest = path.join(dir, "Fails.flac");
        const first = acquireDestinationLock(dest).then((release) => {
            release();
            throw new Error("boom");
        });
        await expect(first).rejects.toThrow("boom");
        const release = await acquireDestinationLock(dest);
        release();
    });
});
