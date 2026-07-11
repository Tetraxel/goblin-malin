import { describe, test, expect } from "vitest";
import { pickAutoSelectedIndex } from "#flows/musicDownloadFlow/utils/sourceSelection";
import { TrackDownloadSource, TrackMetadata, FileInfo } from "#flows/musicDownloadFlow/types";

const track: TrackMetadata = {
    id: "abc",
    trackName: "Title",
    url: "https://youtube.com/watch?v=abc",
    artists: [{ type: "artist", name: "Artist" }],
    platform: "youtube",
    apiProvider: "youtube",
    uri: "YOUTUBE::TRACK::abc",
    fetchedAt: new Date(),
    type: "track",
};

function source(state: TrackDownloadSource["state"], fileInfo?: Partial<FileInfo>): TrackDownloadSource {
    return {
        state,
        provider: "ytdlp",
        track,
        downloadedAt: new Date(),
        selected: false,
        fileInfo: fileInfo
            ? { format: "flac", sizeBytes: 0, durationMs: 0, embeddedTags: {}, ...fileInfo }
            : undefined,
    };
}

describe("pickAutoSelectedIndex", () => {
    test("returns -1 when nothing has been downloaded yet", () => {
        expect(pickAutoSelectedIndex([source("searching"), source("failed")], true)).toBe(-1);
    });

    test("preferLossless off: picks the first successfully downloaded source, ignoring quality", () => {
        const sources = [
            source("downloaded", { provenance: "lossy-transcode" }),
            source("downloaded", { provenance: "lossless" }),
        ];
        expect(pickAutoSelectedIndex(sources, false)).toBe(0);
    });

    test("preferLossless on: picks a lossless source over an earlier transcode", () => {
        const sources = [
            source("downloaded", { provenance: "lossy-transcode" }),
            source("downloaded", { provenance: "lossless" }),
        ];
        expect(pickAutoSelectedIndex(sources, true)).toBe(1);
    });

    test("preferLossless on: prefers lossy over lossy-transcode when no lossless exists", () => {
        const sources = [
            source("downloaded", { provenance: "lossy-transcode" }),
            source("downloaded", { provenance: "lossy", bitrateKbps: 320 }),
        ];
        expect(pickAutoSelectedIndex(sources, true)).toBe(1);
    });

    test("preferLossless on: among same-tier lossy sources, prefers the higher bitrate", () => {
        const sources = [
            source("downloaded", { provenance: "lossy", bitrateKbps: 192 }),
            source("downloaded", { provenance: "lossy", bitrateKbps: 320 }),
        ];
        expect(pickAutoSelectedIndex(sources, true)).toBe(1);
    });

    test("skips non-downloaded sources entirely", () => {
        const sources = [
            source("failed"),
            source("downloading"),
            source("downloaded", { provenance: "lossless" }),
        ];
        expect(pickAutoSelectedIndex(sources, true)).toBe(2);
    });

    test("skipped candidates (never attempted because an earlier one won) are ignored", () => {
        const sources = [
            source("downloaded", { provenance: "lossless" }),
            source("skipped"),
            source("skipped"),
        ];
        expect(pickAutoSelectedIndex(sources, true)).toBe(0);
    });
});
