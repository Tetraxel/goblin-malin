import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type Metadata } from "#utils/metadata";
import { tagAudioFile } from "#flows/musicDownloadFlow/utils/tagAudioFile";

const metadata: Metadata = { trackTitle: "Title", artists: ["Artist"] };

describe("tagAudioFile — FLAC failures", () => {
    let dir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-tag-flac-"));
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test("rejects (so the save is not reported as done) when the file is not a valid FLAC", async () => {
        const file = path.join(dir, "not-a-flac.flac");
        fs.writeFileSync(file, Buffer.from("this is definitely not a flac stream"));

        await expect(tagAudioFile(file, metadata)).rejects.toThrow();
    });

    test("rejects when the file does not exist", async () => {
        await expect(tagAudioFile(path.join(dir, "missing.flac"), metadata)).rejects.toThrow();
    });
});
