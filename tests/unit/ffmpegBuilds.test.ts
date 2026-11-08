import { beforeEach, describe, expect, test, vi } from "vitest";

const httpsGetJson = vi.hoisted(() => vi.fn());
vi.mock("#utils/http", () => ({ httpsGetJson }));

import { FFMPEG_BUILDS_REPO, getLatestWin64Build } from "#utils/ffmpegBuilds";

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
