import { describe, test, expect } from "vitest";
import { getProvenanceDisplay } from "#flows/musicDownloadFlow/utils/provenance";
import { FileInfo } from "#flows/musicDownloadFlow/types";

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
