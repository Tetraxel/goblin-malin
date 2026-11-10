import { describe, expect, test, vi } from "vitest";
import type { SavedFile, TrackDownloadSource, TrackMetadata } from "#flows/musicDownloadFlow/types";
import {
    isSavedFrom,
    releaseSavedFile,
    savedFileAsSource,
    savedFileFromLegacyRows,
    type SavedFileHolder,
} from "#flows/musicDownloadFlow/utils/savedSource";
import { reviveTaskDates } from "#flows/musicDownloadFlow/utils/reviveTaskDates";

const track = { id: "1", trackName: "Mode avion", fetchedAt: new Date().toISOString() } as unknown as TrackMetadata;
const saved: SavedFile = {
    path: "C:/Music/Mode avion.flac",
    savedAt: new Date("2026-01-01T00:00:00Z"),
    provider: "soulseek",
    track,
    providerDetail: "LostianGirl",
    downloadPath: "C:/tmp/Soulseek 1.flac",
};
const row = (extra: Partial<TrackDownloadSource> = {}): TrackDownloadSource => ({
    state: "downloaded",
    provider: "soulseek",
    track,
    downloadedAt: new Date(),
    selected: false,
    ...extra,
});

describe("savedFileAsSource", () => {
    test("stands in for the saved file with what it was made from, and no temporary file", () => {
        const source = savedFileAsSource(saved);
        expect(source.provider).toBe("soulseek");
        expect(source.providerDetail).toBe("LostianGirl");
        expect(source.savedFile).toBe(saved);
        expect(source.localFile).toBeUndefined();
        expect(source.selected).toBe(false);
    });
});

describe("isSavedFrom", () => {
    test("recognizes the row holding the download the file was made from", () => {
        const file = { name: "x", extension: "flac" as const, state: "found" as const };
        expect(isSavedFrom(saved, row({ localFile: { ...file, path: "C:/tmp/Soulseek 1.flac" } }))).toBe(true);
        expect(isSavedFrom(saved, row({ localFile: { ...file, path: "C:/tmp/other.flac" } }))).toBe(false);
        expect(isSavedFrom(saved, row())).toBe(false);
        expect(isSavedFrom(undefined, row())).toBe(false);
        expect(isSavedFrom({ ...saved, downloadPath: undefined }, row())).toBe(false);
    });
});

describe("releaseSavedFile", () => {
    const holder = (id: string, attrs: { kind?: string; savedFile?: SavedFile } | undefined): SavedFileHolder => ({
        getId: () => id,
        getAttributes: () => attrs,
        updateAttributes: vi.fn((patch: { savedFile: undefined }) => Object.assign(attrs ?? {}, patch)),
    });

    test("another task that recorded the same file as its own lets go of it", () => {
        const a = holder("a", { kind: "track", savedFile: saved });
        const b = holder("b", { kind: "track", savedFile: { ...saved, path: "C:/Music/other.flac" } });
        const c = holder("c", { kind: "track" });
        const owner = holder("owner", { kind: "track", savedFile: saved });

        expect(releaseSavedFile([a, b, c, owner], "C:/Music/Mode avion.flac", "owner")).toEqual(["a"]);
        expect(a.getAttributes()?.savedFile).toBeUndefined();
        expect(b.getAttributes()?.savedFile).toBeDefined();
        expect(owner.getAttributes()?.savedFile).toBe(saved);
    });

    test("paths are compared the way the file system does (separators; case on Windows)", () => {
        const a = holder("a", { kind: "track", savedFile: { ...saved, path: "C:\\Music\\Mode avion.flac" } });
        const sameName = process.platform === "win32" ? "c:/music/mode avion.flac" : "C:/Music/Mode avion.flac";
        expect(releaseSavedFile([a], sameName, "owner")).toEqual(["a"]);
    });

    test("collections and tasks without attributes are left alone", () => {
        const collection = holder("c", { kind: "collection" });
        const empty = holder("e", undefined);
        expect(releaseSavedFile([collection, empty], saved.path, "owner")).toEqual([]);
        expect(collection.updateAttributes).not.toHaveBeenCalled();
    });
});

describe("sessions written before the saved file moved off the download rows", () => {
    const legacyRow = row({
        providerDetail: "LostianGirl",
        localFile: { name: "x", extension: "flac", state: "found", path: "C:/tmp/Soulseek 1.flac" },
        savedFile: { path: "C:/Music/a.flac", savedAt: "2026-01-01T00:00:00.000Z" as unknown as Date } as SavedFile,
    });

    test("savedFileFromLegacyRows lifts the record and fills in where it came from", () => {
        const lifted = savedFileFromLegacyRows([row({ provider: "ytdlp" }), legacyRow]);
        expect(lifted).toMatchObject({
            path: "C:/Music/a.flac",
            provider: "soulseek",
            providerDetail: "LostianGirl",
            downloadPath: "C:/tmp/Soulseek 1.flac",
        });
        expect(savedFileFromLegacyRows([row()])).toBeUndefined();
    });

    test("loading moves it to the task and strips it from the rows", () => {
        const attrs = {
            kind: "track",
            metadataGroups: [],
            downloadSources: [legacyRow],
        } as never;
        const revived = reviveTaskDates(attrs);
        if (revived.kind !== "track") throw new Error("expected a track");
        expect(revived.savedFile?.path).toBe("C:/Music/a.flac");
        expect(revived.savedFile?.savedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
        expect(revived.downloadSources[0].savedFile).toBeUndefined();
    });

    test("a task that already has its own saved file keeps it", () => {
        const attrs = { kind: "track", metadataGroups: [], downloadSources: [], savedFile: saved } as never;
        const revived = reviveTaskDates(attrs);
        if (revived.kind !== "track") throw new Error("expected a track");
        expect(revived.savedFile).toEqual(saved);
    });
});
