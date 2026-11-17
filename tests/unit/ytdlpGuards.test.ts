import { beforeEach, describe, expect, test, vi } from "vitest";
import { YtDlpService } from "#flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService";
import { globalLogger } from "#base/logger/logger";
import { killProcessTree } from "#utils/killProcessTree";
import { makeTrack, meta } from "./helpers/agentWorld";

// Audit v0.2.3, "Downloads": what yt-dlp is told (DL-07, DL-08), a signal that is already aborted (DL-04), a killed
// run that exits with an error code (DL-05) and the process tree on Windows.

const calls = vi.hoisted(() => ({
    downloads: 0,
    options: undefined as any,
    /** What the fake run does: resolves when `release` is called, rejects after a kill. */
    release: undefined as undefined | (() => void),
    killed: 0,
}));

vi.mock("#flows/musicDownloadFlow/services/apis/ytdlp-client", () => ({
    getYtDlpClient: async () => ({
        download: (_url: string, options: unknown) => {
            calls.downloads++;
            calls.options = options;
            let fail!: (error: Error) => void;
            const handle: any = {
                on: () => handle,
                kill: () => {
                    calls.killed++;
                    // A killed yt-dlp exits with an error code on Windows: the library turns that into a rejection.
                    fail(new Error("yt-dlp exited with code 1: killed"));
                    return true;
                },
                run: () => new Promise<void>((_resolve, reject) => (fail = reject)),
            };
            return handle;
        },
    }),
}));

const track = () => ({ ...meta("dQw4w9WgXcQ", "Song", "Artist", "youtube"), url: "https://youtu.be/dQw4w9WgXcQ" });
const service = () => new YtDlpService(makeTrack("t", "Song"), globalLogger);

beforeEach(() => {
    calls.downloads = 0;
    calls.options = undefined;
    calls.killed = 0;
});

describe("what yt-dlp is told", () => {
    test("it ignores the user's own config and skips live streams, huge files and very long videos", async () => {
        // The fake run never ends by itself: it is stopped once yt-dlp has been started.
        const controller = new AbortController();
        const result = service()
            .downloadTrack(track(), undefined, controller.signal)
            .catch(() => undefined);
        for (let i = 0; i < 100 && calls.downloads === 0; i++) await new Promise((r) => setTimeout(r, 10));
        controller.abort();
        await result;
        expect(calls.options).toMatchObject({ ignoreConfig: true, noPlaylist: true, maxFilesize: "500M" });
        expect(calls.options.matchFilter).toContain("!is_live");
        expect(calls.options.matchFilter).toContain("duration<=?");
    }, 3000);
});

describe("stopping a download", () => {
    test("a signal that is already aborted never starts yt-dlp, nor shows a row", async () => {
        const controller = new AbortController();
        controller.abort();
        const updates: unknown[] = [];
        await expect(
            service().downloadTrack(track(), (source) => updates.push(source), controller.signal)
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(calls.downloads).toBe(0);
        expect(updates).toEqual([]);
    });

    test("a killed run that exits with an error is a stop, not a failed download", async () => {
        const controller = new AbortController();
        const result = service().downloadTrack(track(), undefined, controller.signal);
        for (let i = 0; i < 100 && calls.downloads === 0; i++) await new Promise((r) => setTimeout(r, 10));
        expect(calls.downloads).toBe(1);
        controller.abort();
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
        expect(calls.killed).toBe(1);
    });
});

describe("killProcessTree", () => {
    test("kills the process, and never throws when it is already gone", () => {
        const kill = vi.fn(() => {
            throw new Error("ESRCH");
        });
        expect(() => killProcessTree({ kill, pid: undefined })).not.toThrow();
        expect(kill).toHaveBeenCalledTimes(1);
    });
});
