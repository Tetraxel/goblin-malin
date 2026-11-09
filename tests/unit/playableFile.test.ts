import { describe, expect, test } from "vitest";
import { playableFilePath } from "#flows/musicDownloadFlow/utils/playableFile";

type Src = Parameters<typeof playableFilePath>[0];
const local = (state: "found" | "not_found"): Src["localFile"] => ({
    state,
    path: "C:\\tmp\\a.flac",
    name: "a",
    extension: "flac",
});
const saved = { path: "D:\\Music\\a.flac", savedAt: new Date() } as Src["savedFile"];

describe("playableFilePath", () => {
    test("the temporary copy while it is there", () => {
        expect(playableFilePath({ localFile: local("found"), savedFile: saved })).toBe("C:\\tmp\\a.flac");
        expect(playableFilePath({ localFile: local("found") })).toBe("C:\\tmp\\a.flac");
    });

    test("the saved file once the temporary copy is gone, so a saved track keeps its player and Update", () => {
        expect(playableFilePath({ localFile: local("not_found"), savedFile: saved })).toBe("D:\\Music\\a.flac");
        expect(playableFilePath({ savedFile: saved })).toBe("D:\\Music\\a.flac");
    });

    test("nothing when neither exists", () => {
        expect(playableFilePath({ localFile: local("not_found") })).toBeNull();
        expect(playableFilePath({})).toBeNull();
    });
});
