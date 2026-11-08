import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const httpsGetText = vi.hoisted(() => vi.fn());
vi.mock("#utils/http", () => ({ httpsGetText }));
vi.mock("#base/logger/logger", () => ({
    globalLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ChecksumMismatchError, parseChecksums, sha256File, verifyAgainstPublishedChecksums } from "#utils/checksum";

// sha256("hello")
const HELLO = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

let tmp: string;
let file: string;

beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gm-checksum-"));
});
afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
    httpsGetText.mockReset();
    file = path.join(tmp, "yt-dlp.exe");
    await fs.writeFile(file, "hello");
});

describe("parseChecksums", () => {
    test("reads text and binary mode lines, CRLF included", () => {
        const text = `${HELLO}  yt-dlp.exe\r\n${"a".repeat(64)} *yt-dlp\n# not a checksum\n`;
        expect(parseChecksums(text)).toEqual(
            new Map([
                ["yt-dlp.exe", HELLO],
                ["yt-dlp", "a".repeat(64)],
            ])
        );
    });
});

describe("verifyAgainstPublishedChecksums", () => {
    test("hashes the file", async () => {
        expect(await sha256File(file)).toBe(HELLO);
    });

    test("verified when the hash matches", async () => {
        httpsGetText.mockResolvedValue(`${HELLO}  yt-dlp.exe\n`);
        await expect(verifyAgainstPublishedChecksums(file, "u", "yt-dlp.exe", "ua")).resolves.toBe("verified");
        await expect(fs.access(file)).resolves.toBeUndefined();
    });

    test("a mismatch throws and deletes the file", async () => {
        httpsGetText.mockResolvedValue(`${"b".repeat(64)}  yt-dlp.exe\n`);
        await expect(verifyAgainstPublishedChecksums(file, "u", "yt-dlp.exe", "ua")).rejects.toBeInstanceOf(
            ChecksumMismatchError
        );
        await expect(fs.access(file)).rejects.toThrow();
    });

    test("an unreachable checksum list is not fatal: the file is kept, unverified", async () => {
        httpsGetText.mockRejectedValue(new Error("HTTP 404 from u"));
        await expect(verifyAgainstPublishedChecksums(file, "u", "yt-dlp.exe", "ua")).resolves.toBe("unverified");
        await expect(fs.access(file)).resolves.toBeUndefined();
    });

    test("a list that does not mention the asset is not fatal either", async () => {
        httpsGetText.mockResolvedValue(`${HELLO}  something-else.zip\n`);
        await expect(verifyAgainstPublishedChecksums(file, "u", "yt-dlp.exe", "ua")).resolves.toBe("unverified");
    });
});
