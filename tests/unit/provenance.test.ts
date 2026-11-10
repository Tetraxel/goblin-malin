import { describe, test, expect } from "vitest";
import { getProvenanceDisplay, getSavedFileDisplay } from "#flows/musicDownloadFlow/utils/provenance";
import { type FileInfo } from "#flows/musicDownloadFlow/types";

function fileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
    return { format: "flac", sizeBytes: 0, durationMs: 0, embeddedTags: {}, ...overrides };
}

describe("getProvenanceDisplay", () => {
    test("missing fileInfo renders an empty, neutral badge", () => {
        expect(getProvenanceDisplay(undefined)).toEqual({ badge: "", tone: "neutral" });
    });

    test("lossless: plain format badge, success tone, no detail", () => {
        const result = getProvenanceDisplay(fileInfo({ provenance: "lossless" }));
        expect(result).toEqual({ badge: "FLAC", tone: "success" });
    });

    test("lossy-transcode: starred badge, warning tone, honest detail naming the real source codec", () => {
        const result = getProvenanceDisplay(
            fileInfo({ format: "flac", provenance: "lossy-transcode", sourceCodec: "Opus" })
        );
        expect(result.badge).toBe("FLAC*");
        expect(result.tone).toBe("warning");
        expect(result.detail).toBe("FLAC (transcoded from Opus)");
    });

    test("lossy-transcode without a known sourceCodec still flags it, generically", () => {
        const result = getProvenanceDisplay(fileInfo({ format: "flac", provenance: "lossy-transcode" }));
        expect(result.tone).toBe("warning");
        expect(result.detail).toBe("FLAC (transcoded, not a true lossless source)");
    });

    test("lossy: shows the real probed bitrate when available", () => {
        const result = getProvenanceDisplay(fileInfo({ format: "mp3", provenance: "lossy", bitrateKbps: 320 }));
        expect(result).toEqual({ badge: "MP3 320", tone: "neutral" });
    });

    test("lossy without a probed bitrate falls back to just the format", () => {
        const result = getProvenanceDisplay(fileInfo({ format: "mp3", provenance: "lossy" }));
        expect(result.badge).toBe("MP3");
    });

    test("unknown/absent provenance falls back to a neutral format badge", () => {
        const result = getProvenanceDisplay(fileInfo({ format: "flac" }));
        expect(result).toEqual({ badge: "FLAC", tone: "neutral" });
    });
});

describe("getSavedFileDisplay", () => {
    test("a file that was not re-encoded is described by its download", () => {
        const info = fileInfo({ format: "flac", provenance: "lossless" });
        expect(getSavedFileDisplay(info)).toEqual(getProvenanceDisplay(info));
        expect(getSavedFileDisplay(undefined)).toEqual({ badge: "", tone: "neutral" });
    });

    test("a lossy download converted to FLAC is a transcode, naming what it came from", () => {
        const result = getSavedFileDisplay(fileInfo({ format: "opus", provenance: "lossy", bitrateKbps: 130 }), {
            format: "flac",
            sizeBytes: 1,
        });
        expect(result).toEqual({ badge: "FLAC*", tone: "warning", detail: "FLAC (transcoded from OPUS 130)" });
    });

    test("a lossless download converted to FLAC is plain FLAC, with no warning", () => {
        const result = getSavedFileDisplay(fileInfo({ format: "flac", provenance: "lossless" }), {
            format: "flac",
            sizeBytes: 1,
        });
        expect(result).toEqual({ badge: "FLAC", tone: "success" });
    });

    test("a download converted to a lossy format shows the nominal bitrate and where it came from", () => {
        const result = getSavedFileDisplay(fileInfo({ format: "flac", provenance: "lossless" }), {
            format: "mp3",
            sizeBytes: 1,
        });
        expect(result).toEqual({ badge: "MP3 320", tone: "neutral", detail: "MP3 (converted from FLAC)" });
    });

    test("a known source codec wins over the file format", () => {
        const result = getSavedFileDisplay(
            fileInfo({ format: "flac", provenance: "lossy-transcode", sourceCodec: "Opus" }),
            { format: "mp3", sizeBytes: 1 }
        );
        expect(result.detail).toBe("MP3 (converted from Opus)");
    });

    test("an unknown target format falls back to the download's own badge", () => {
        const info = fileInfo({ format: "mp3", provenance: "lossy", bitrateKbps: 128 });
        expect(getSavedFileDisplay(info, { format: "wav", sizeBytes: 1 })).toEqual(getProvenanceDisplay(info));
    });
});
