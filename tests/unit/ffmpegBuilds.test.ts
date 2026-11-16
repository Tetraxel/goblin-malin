import { beforeEach, describe, expect, test, vi } from "vitest";

const httpsGetJson = vi.hoisted(() => vi.fn());
vi.mock("#utils/http", () => ({ httpsGetJson }));

import { FFMPEG_BUILDS_REPO, getLatestWin64Build, pickWin64Archive } from "#utils/ffmpegBuilds";

beforeEach(() => {
    httpsGetJson.mockReset();
});

describe("getLatestWin64Build", () => {
    test("points at the FFmpeg-Builds organisation, not the old BtbN owner", async () => {
        httpsGetJson.mockResolvedValue({ tag_name: "latest", published_at: "2026-11-08T12:54:01Z" });

        const build = await getLatestWin64Build("test");

        expect(FFMPEG_BUILDS_REPO).toBe("FFmpeg-Builds/FFmpeg-Builds");
        expect(httpsGetJson).toHaveBeenCalledWith(
            "https://api.github.com/repos/FFmpeg-Builds/FFmpeg-Builds/releases/latest",
            { userAgent: "test" }
        );
        expect(build).toEqual({
            versionId: "2026-11-08",
            downloadUrl:
                "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
            archiveName: "ffmpeg-master-latest-win64-gpl.zip",
            checksumsUrl: "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/latest/checksums.sha256",
        });
    });

    // The old code did `new Date(undefined).toISOString()` here and threw an unreadable
    // "RangeError: Invalid time value" that the caller then swallowed (DL-01).
    test.each([
        ["a missing published_at", { tag_name: "latest" }],
        ["an unparseable published_at", { tag_name: "latest", published_at: "yesterday" }],
        ["a missing tag_name", { published_at: "2026-11-08T12:54:01Z" }],
        ["GitHub's 'Moved Permanently' body", { message: "Moved Permanently", status: "301" }],
    ])("rejects %s with a readable message", async (_label, body) => {
        httpsGetJson.mockResolvedValue(body);
        await expect(getLatestWin64Build("test")).rejects.toThrow(/Unexpected release metadata/);
    });

    test("passes a network failure through unchanged", async () => {
        httpsGetJson.mockImplementation(async () => {
            throw new Error("HTTP 403 from https://api.github.com/...");
        });
        await expect(getLatestWin64Build("test")).rejects.toThrow("HTTP 403");
    });
});

// BIN-02: the development branch, rebuilt every night, was what everybody got.
describe("which build is installed", () => {
    const assets = [
        "ffmpeg-master-latest-win64-gpl-shared.zip",
        "ffmpeg-master-latest-win64-gpl.zip",
        "ffmpeg-n8.1-latest-win64-gpl-8.1.zip",
        "ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip",
        "ffmpeg-n9.0-latest-win64-gpl-9.0.zip",
        "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip",
        "ffmpeg-n10.2-latest-win64-gpl-10.2.zip",
        "ffmpeg-n9.1-latest-win64-gpl-9.1.zip",
        "checksums.sha256",
    ];

    test("the newest stable branch, by number (10 is after 9)", () => {
        expect(pickWin64Archive(assets)).toEqual({ name: "ffmpeg-n10.2-latest-win64-gpl-10.2.zip", branch: "n10.2" });
    });

    test("never the shared build, nor a build of another license or platform", () => {
        const picked = pickWin64Archive([
            "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip",
            "ffmpeg-n9.0-latest-win64-lgpl-9.0.zip",
            "ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz",
        ]);
        expect(picked).toEqual({ name: "ffmpeg-master-latest-win64-gpl.zip" });
    });

    test("the development branch only when there is nothing else", () => {
        expect(pickWin64Archive([])).toEqual({ name: "ffmpeg-master-latest-win64-gpl.zip" });
    });

    test("the cached binary is named by branch and month, so the daily rebuild does not download 200 MB again", async () => {
        httpsGetJson.mockResolvedValue({
            tag_name: "latest",
            published_at: "2026-11-16T15:50:35Z",
            assets: assets.map((name) => ({ name })),
        });
        const build = await getLatestWin64Build("test");
        expect(build.versionId).toBe("n10.2-2026-11");
        expect(build.downloadUrl).toMatch(/\/latest\/ffmpeg-n10\.2-latest-win64-gpl-10\.2\.zip$/);
        expect(build.archiveName).toBe("ffmpeg-n10.2-latest-win64-gpl-10.2.zip");

        httpsGetJson.mockResolvedValue({
            tag_name: "latest",
            published_at: "2026-11-30T01:00:00Z",
            assets: assets.map((name) => ({ name })),
        });
        expect((await getLatestWin64Build("test")).versionId).toBe("n10.2-2026-11");
    });
});
