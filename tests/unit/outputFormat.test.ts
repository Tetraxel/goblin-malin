import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    OUTPUT_FORMATS,
    OUTPUT_FORMAT_KEYS,
    parseOutputFormat,
    planSave,
    previewOutputExtension,
    resolveOutputExtension,
} from "#flows/musicDownloadFlow/utils/outputFormat";

const on = (convertFormat: string) => ({ convertAudio: true, convertFormat });
const off = { convertAudio: false, convertFormat: "flac" };

describe("OUTPUT_FORMATS", () => {
    it("has a row per key, whose extension is the key", () => {
        for (const key of OUTPUT_FORMAT_KEYS) expect(OUTPUT_FORMATS[key].ext).toBe(key);
    });

    it("gives every lossy format a nominal bitrate and no lossless one", () => {
        for (const key of OUTPUT_FORMAT_KEYS) {
            const format = OUTPUT_FORMATS[key];
            expect(format.kbps !== undefined).toBe(!format.lossless);
        }
    });
});

describe("parseOutputFormat", () => {
    it("keeps a known format", () => {
        expect(parseOutputFormat("mp3")).toBe("mp3");
    });

    it("falls back to FLAC for anything else", () => {
        expect(parseOutputFormat("wav")).toBe("flac");
        expect(parseOutputFormat(undefined)).toBe("flac");
        expect(parseOutputFormat(42)).toBe("flac");
        // Keys of Object.prototype are not formats.
        expect(parseOutputFormat("toString")).toBe("flac");
    });
});

describe("resolveOutputExtension", () => {
    it("is the chosen format when converting, whatever the download is", () => {
        expect(resolveOutputExtension(on("mp3"), path.join("tmp", "a.opus"))).toBe("mp3");
        expect(resolveOutputExtension(on("nonsense"), path.join("tmp", "a.opus"))).toBe("flac");
    });

    it("is the download's own extension when not converting", () => {
        expect(resolveOutputExtension(off, path.join("tmp", "a.OPUS"))).toBe("opus");
        expect(resolveOutputExtension(off, path.join("tmp", "a.mp3"))).toBe("mp3");
    });

    it("is FLAC when not converting and there is no file to ask", () => {
        expect(resolveOutputExtension(off)).toBe("flac");
        expect(resolveOutputExtension(off, "noextension")).toBe("flac");
    });
});

describe("planSave", () => {
    const opus = path.join("tmp", "YtDlp a 1.opus");
    const flac = path.join("tmp", "YtDlp a 1.flac");
    const mp3 = path.join("tmp", "Soulseek a 2.mp3");

    it("copies a download that is already in the wanted format", () => {
        expect(planSave(on("flac"), flac)).toEqual({ extension: "flac", mode: "fromDownload", convert: false });
        expect(planSave(off, mp3)).toEqual({ extension: "mp3", mode: "fromDownload", convert: false });
    });

    it("re-encodes a download that is in another format - an MP3 is never saved as a .flac", () => {
        expect(planSave(on("flac"), mp3)).toEqual({ extension: "flac", mode: "fromDownload", convert: true });
        expect(planSave(on("mp3"), opus)).toEqual({ extension: "mp3", mode: "fromDownload", convert: true });
    });

    it("re-tags a saved file in place when it already has the wanted format", () => {
        const saved = path.join("out", "a.flac");
        expect(planSave(on("flac"), flac, saved)).toEqual({ extension: "flac", mode: "reuse", convert: false });
        expect(planSave(off, flac, saved)).toEqual({ extension: "flac", mode: "reuse", convert: false });
    });

    it("makes the file again from the download when the wanted format changed since it was saved", () => {
        const saved = path.join("out", "a.flac");
        expect(planSave(on("mp3"), flac, saved)).toEqual({ extension: "mp3", mode: "fromDownload", convert: true });
    });

    it("keeps the saved file's own format once the download is gone, whatever the setting says", () => {
        const saved = path.join("out", "a.flac");
        expect(planSave(on("mp3"), undefined, saved)).toEqual({ extension: "flac", mode: "reuse", convert: false });
    });

    it("refuses to save with nothing to save from", () => {
        expect(() => planSave(on("flac"))).toThrow("Local file not found");
    });
});

describe("previewOutputExtension", () => {
    it("follows the plan when there is a file, and the setting when there is none", () => {
        expect(previewOutputExtension(on("mp3"), path.join("tmp", "a.opus"))).toBe("mp3");
        expect(previewOutputExtension(on("ogg"))).toBe("ogg");
        expect(previewOutputExtension(off)).toBe("flac");
    });
});
