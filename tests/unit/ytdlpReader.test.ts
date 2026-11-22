import { beforeEach, describe, expect, test, vi } from "vitest";

// Audit v0.2.4, YTDLP-01 / YTDLP-02: reading a page through yt-dlp (SoundCloud) must not set up ffmpeg, must not run
// at all when the user switched yt-dlp off, ignores the user's own yt-dlp config, and ends when its caller gives up.

const state = vi.hoisted(() => ({
    enabled: true,
    binarySetups: 0,
    ffmpegSetups: 0,
    execOptions: undefined as Record<string, unknown> | undefined,
    killed: 0,
    /** Settles the fake run: its JSON, or nothing yet. */
    answer: undefined as undefined | ((output: string) => void),
}));

vi.mock("ytdlp-nodejs", () => ({
    YtDlp: class {
        constructor(readonly options: { binaryPath: string; ffmpegPath?: string }) {}
        exec(_url: string, options: Record<string, unknown>) {
            state.execOptions = options;
            let fail!: (error: Error) => void;
            const done = new Promise<{ output: string }>((resolve, reject) => {
                state.answer = (output) => resolve({ output });
                fail = reject;
            });
            return {
                run: () => done,
                kill: () => {
                    state.killed++;
                    fail(new Error("killed"));
                    return true;
                },
            };
        }
    },
}));
vi.mock("#flows/musicDownloadFlow/services/download-providers/ytdlp/ytdlp-setup", () => ({
    ensureYtDlpSetup: async () => {
        state.binarySetups++;
        return "/bin/yt-dlp";
    },
}));
vi.mock("#utils/ffmpeg-setup", () => ({
    ensureFfmpeg: async () => {
        state.ffmpegSetups++;
        return "/bin/ffmpeg";
    },
}));
vi.mock("#flows/musicDownloadFlow/saveSettings", () => ({
    getDownloadProviderSettings: () => ({ enabled: state.enabled }),
}));

const { readYtDlpInfo, YtDlpDisabledError } = await import("#flows/musicDownloadFlow/services/apis/ytdlp-client");
const { ProviderUnavailableError } = await import("#base/providerUnavailableError");

const options = { timeoutMs: 5_000, timeoutMessage: "too slow", site: "SoundCloud" };

beforeEach(() => {
    state.enabled = true;
    state.execOptions = undefined;
    state.killed = 0;
    state.answer = undefined;
});

const started = () => vi.waitFor(() => expect(state.answer).toBeDefined());

describe("reading a page through yt-dlp", () => {
    test("with yt-dlp switched off, nothing is set up or run, and the reason is a ProviderUnavailableError", async () => {
        state.enabled = false;
        const error = await readYtDlpInfo("https://soundcloud.com/a/b", options).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(YtDlpDisabledError);
        expect(error).toBeInstanceOf(ProviderUnavailableError);
        expect(state.binarySetups).toBe(0);
        expect(state.ffmpegSetups).toBe(0);
    });

    test("needs the binary only, never ffmpeg, and ignores the user's yt-dlp config", async () => {
        const read = readYtDlpInfo<{ title: string }>("https://soundcloud.com/a/b", options);
        await started();
        state.answer?.(JSON.stringify({ title: "Song" }));
        expect(await read).toEqual({ title: "Song" });
        expect(state.binarySetups).toBe(1);
        expect(state.ffmpegSetups).toBe(0);
        expect(state.execOptions).toMatchObject({ dumpSingleJson: true, ignoreConfig: true });
    });

    test("a caller that gives up kills the process", async () => {
        const controller = new AbortController();
        const read = readYtDlpInfo("scsearch8:a b", { ...options, signal: controller.signal });
        await started();
        controller.abort();
        await expect(read).rejects.toThrow();
        expect(state.killed).toBeGreaterThan(0);
    });
});
