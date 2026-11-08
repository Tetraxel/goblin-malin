import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DownloadUpdateCallback } from "#flows/musicDownloadFlow/downloadService";
import type { TrackDownloadSource, TrackMetadata } from "#flows/musicDownloadFlow/types";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first,
// hence the dynamic imports below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-retry-provider-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const track = {
    id: "yt1",
    trackName: "Jersey",
    artists: [{ type: "artist", name: "U&I" }],
    duration: 200_000,
    url: "https://youtube.test/yt1",
    uri: "YOUTUBE::TRACK::yt1",
    platform: "youtube",
    apiProvider: "youtube",
    fetchedAt: new Date(),
    type: "track",
} as unknown as TrackMetadata;

const row = (
    provider: "ytdlp" | "soulseek",
    state: TrackDownloadSource["state"],
    extra: Partial<TrackDownloadSource> = {}
): TrackDownloadSource => ({
    state,
    provider,
    track,
    downloadedAt: new Date(),
    selected: false,
    ...extra,
});

// What each fake provider does when asked to download; tests set these.
let ytdlpRuns = 0;
let soulseekRuns = 0;
let soulseekOutcome: "failed" | "downloaded";

let m: {
    DownloadTask: typeof DownloadTaskType;
    makeTask: (sources: TrackDownloadSource[], extra?: { downloadsFetched?: boolean }) => DownloadTaskType;
};

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { DownloadService } = await import("#flows/musicDownloadFlow/downloadService");
    const { globalLogger } = await import("#base/logger/logger");
    const { DownloadTask } = await import("#flows/musicDownloadFlow/utils/downloadTask");

    class FakeYtdlp extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeYtdlp", task, logger);
        }
        async downloadTrack(meta: TrackMetadata, onUpdate?: DownloadUpdateCallback) {
            ytdlpRuns++;
            onUpdate?.(row("ytdlp", "downloading", { track: meta }));
            return row("ytdlp", "downloaded", { track: meta });
        }
    }
    // Like Soulseek: one row per candidate, each addressed by its own attempt id.
    class FakeSoulseek extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSoulseek", task, logger);
        }
        async downloadTrack(meta: TrackMetadata, onUpdate?: DownloadUpdateCallback) {
            soulseekRuns++;
            for (const id of ["a", "b", "c"]) {
                onUpdate?.(row("soulseek", "failed", { track: meta, providerDetail: `${id}#${soulseekRuns}` }), {
                    attemptId: id,
                });
            }
            return row("soulseek", soulseekOutcome, { track: meta, providerDetail: `c#${soulseekRuns}` });
        }
    }

    m = {
        DownloadTask,
        makeTask: (sources, extra = {}) => {
            const download = new ServiceRegistry<DownloadTaskType, any>();
            download.register("ytdlp", FakeYtdlp as never).register("soulseek", FakeSoulseek as never);
            const unused = new ServiceRegistry<DownloadTaskType, any>();
            return new DownloadTask({
                id: "t1",
                initialInput: track.url,
                attributes: {
                    kind: "track",
                    state: "finished",
                    userInput: { type: "url", url: track.url },
                    metadataGroups: [
                        {
                            platform: "youtube",
                            serviceKey: "youtube",
                            rank: 0,
                            results: [
                                {
                                    metadata: track,
                                    isPrimaryInput: true,
                                    isFavorited: false,
                                    isRejected: false,
                                    rank: 0,
                                    discoverySources: [],
                                },
                            ],
                        },
                    ],
                    metadataOverride: {},
                    downloadSources: sources,
                    downloadsFetched: extra.downloadsFetched ?? true,
                    toTag: true,
                    toDownload: true,
                },
                logger: globalLogger,
                metadataServiceRegistry: unused,
                discoveryServiceRegistry: unused,
                downloadServiceRegistry: download,
                isMetadataServiceEnabled: () => true,
                isDiscoveryServiceEnabled: () => true,
                isDownloadServiceEnabled: () => true,
            });
        },
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const sourcesOf = (task: DownloadTaskType) => task.getAttributes()?.downloadSources ?? [];
const summary = (task: DownloadTaskType) => sourcesOf(task).map((s) => `${s.provider}:${s.state}`);

describe("retryDownloadProvider", () => {
    test("replaces one provider's rows in place and leaves the others alone", async () => {
        soulseekOutcome = "failed";
        soulseekRuns = 0;
        const failedYt = row("ytdlp", "failed", { providerDetail: "old-yt" });
        const task = m.makeTask([
            failedYt,
            row("soulseek", "failed", { providerDetail: "old-1" }),
            row("soulseek", "failed", { providerDetail: "old-2" }),
        ]);

        await task.retryDownloadProvider("soulseek");

        const sources = sourcesOf(task);
        // yt-dlp's row is the very same one, still first; soulseek's two old rows became the new three.
        expect(sources[0]).toEqual(failedYt);
        expect(sources.slice(1).map((s) => s.providerDetail)).toEqual(["a#1", "b#1", "c#1"]);
        expect(sources.every((s, i) => i === 0 || s.provider === "soulseek")).toBe(true);
    });

    test("a provider listed first keeps its place when its rows are replaced", async () => {
        soulseekRuns = 0;
        ytdlpRuns = 0;
        const oldSoulseek = [row("soulseek", "failed", { providerDetail: "s1" })];
        const task = m.makeTask([row("ytdlp", "failed"), ...oldSoulseek]);

        await task.retryDownloadProvider("ytdlp");

        expect(ytdlpRuns).toBe(1);
        expect(summary(task)).toEqual(["ytdlp:downloaded", "soulseek:failed"]);
        expect(sourcesOf(task)[1]).toEqual(oldSoulseek[0]);
    });

    test("picks a new selection when the selected row went away with its provider", async () => {
        const task = m.makeTask([row("ytdlp", "failed", { selected: true }), row("soulseek", "failed")]);

        await task.retryDownloadProvider("ytdlp");

        expect(sourcesOf(task).map((s) => s.selected)).toEqual([true, false]);
        expect(sourcesOf(task)[0].state).toBe("downloaded");
    });

    test("keeps a selection that lives on another provider", async () => {
        soulseekOutcome = "failed";
        const task = m.makeTask([row("ytdlp", "downloaded", { selected: true }), row("soulseek", "failed")]);

        await task.retryDownloadProvider("soulseek");

        expect(sourcesOf(task)[0].selected).toBe(true);
        expect(sourcesOf(task).slice(1).some((s) => s.selected)).toBe(false);
    });

    test("does nothing for a provider that has no rows", async () => {
        ytdlpRuns = 0;
        const task = m.makeTask([row("soulseek", "failed")]);

        await task.retryDownloadProvider("ytdlp");

        expect(ytdlpRuns).toBe(0);
        expect(summary(task)).toEqual(["soulseek:failed"]);
    });
});

describe("canRetryDownloadProvider", () => {
    test("is true once the first pass is done and nothing else is running", () => {
        const task = m.makeTask([row("ytdlp", "failed"), row("soulseek", "failed")]);
        expect(task.canRetryDownloadProvider("ytdlp")).toBe(true);
        expect(task.canRetryDownloadProvider("soulseek")).toBe(true);
    });

    test("is false while the first download pass is still running", () => {
        const task = m.makeTask([row("ytdlp", "downloading")], { downloadsFetched: false });
        expect(task.canRetryDownloadProvider("ytdlp")).toBe(false);
    });

    test("is false while another provider's row is in flight (its position would shift)", () => {
        const task = m.makeTask([row("ytdlp", "failed"), row("soulseek", "downloading")]);
        expect(task.canRetryDownloadProvider("ytdlp")).toBe(false);
        // …but a provider's own in-flight rows are fine: they are cancelled and redone.
        expect(task.canRetryDownloadProvider("soulseek")).toBe(true);
    });

    test("is false when one of the provider's files is already saved", () => {
        const savedFile = { path: "C:/music/Jersey.flac", savedAt: new Date() };
        const task = m.makeTask([row("ytdlp", "downloaded", { savedFile }), row("soulseek", "failed")]);
        expect(task.canRetryDownloadProvider("ytdlp")).toBe(false);
        expect(task.canRetryDownloadProvider("soulseek")).toBe(true);
    });

    test("is false for a provider with no rows", () => {
        const task = m.makeTask([row("soulseek", "failed")]);
        expect(task.canRetryDownloadProvider("ytdlp")).toBe(false);
    });
});
