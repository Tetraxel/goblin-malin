import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DownloadUpdateCallback } from "#flows/musicDownloadFlow/downloadService";
import type { TrackDownloadSource, TrackMetadata } from "#flows/musicDownloadFlow/types";

// A transfer runs for minutes. Meanwhile another provider can be retried, or more results shown: positions shift. What
// the transfer writes, and what "reject" cancels, must still be the same row.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-rowkeys-test-"));
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

/** What the fake Soulseek does when a single candidate is retried: tests drive it by hand. */
let retry: {
    started: Promise<void>;
    announce: (abort: () => void) => void;
    finish: (row: TrackDownloadSource) => void;
};
function newRetry() {
    let startedResolve!: () => void;
    let finishResolve!: (row: TrackDownloadSource) => void;
    let announceFn: (abort: () => void) => void = () => {};
    const started = new Promise<void>((resolve) => (startedResolve = resolve));
    const finished = new Promise<TrackDownloadSource>((resolve) => (finishResolve = resolve));
    retry = {
        started,
        announce: (abort) => announceFn(abort),
        finish: finishResolve,
    };
    return {
        run: async (onUpdate?: DownloadUpdateCallback) => {
            announceFn = (abort) =>
                onUpdate?.(row("soulseek", "downloading", { providerDetail: "retried" }), { abort });
            startedResolve();
            return finished;
        },
    };
}

let m: { makeTask: (sources: TrackDownloadSource[]) => DownloadTaskType };
let currentRetry: ReturnType<typeof newRetry>;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { DownloadService } = await import("#flows/musicDownloadFlow/downloadService");
    const { globalLogger } = await import("#base/logger/logger");
    const { DownloadTask } = await import("#flows/musicDownloadFlow/utils/downloadTask");

    class FakeSoulseek extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSoulseek", task, logger);
        }
        async downloadTrack() {
            return row("soulseek", "failed");
        }
        async retryCandidate(_meta: TrackMetadata, _payload: unknown, onUpdate?: DownloadUpdateCallback) {
            return currentRetry.run(onUpdate);
        }
    }

    m = {
        makeTask: (sources) => {
            const download = new ServiceRegistry<DownloadTaskType, never>();
            download.register("soulseek", FakeSoulseek as never);
            const unused = new ServiceRegistry<DownloadTaskType, never>();
            return new DownloadTask({
                id: "t1",
                initialInput: track.url,
                attributes: {
                    kind: "track",
                    state: "finished",
                    userInput: { type: "url", url: track.url },
                    metadataGroups: [],
                    metadataOverride: {},
                    downloadSources: sources,
                    downloadsFetched: true,
                    toTag: true,
                    toDownload: true,
                },
                logger: globalLogger,
                metadataServiceRegistry: unused as never,
                discoveryServiceRegistry: unused as never,
                downloadServiceRegistry: download as never,
                isMetadataServiceEnabled: () => true,
                isDiscoveryServiceEnabled: () => true,
                isDownloadServiceEnabled: () => true,
            });
        },
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const rowsOf = (task: DownloadTaskType) => task.getAttributes()?.downloadSources ?? [];
const names = (task: DownloadTaskType) => rowsOf(task).map((s) => `${s.provider}:${s.providerDetail}:${s.state}`);

describe("a single candidate retried while the list changes", () => {
    test("writes its answer to its own row, not to whatever is now at its old position", async () => {
        currentRetry = newRetry();
        const task = m.makeTask([
            row("ytdlp", "downloaded", { providerDetail: "yt" }),
            row("soulseek", "skipped", { providerDetail: "A", retryPayload: { id: "A" } }),
            row("soulseek", "skipped", { providerDetail: "B", retryPayload: { id: "B" } }),
        ]);

        const retrying = task.retryDownloadSource(1); // A
        await retry.started;

        // The first row goes away (its provider was retried): A is now at position 0, B at 1.
        task.updateAttributes({ downloadSources: rowsOf(task).slice(1) });
        expect(names(task)[0]).toMatch(/^soulseek:A/);

        retry.finish(row("soulseek", "downloaded", { providerDetail: "A" }));
        await retrying;

        expect(names(task)).toEqual(["soulseek:A:downloaded", "soulseek:B:skipped"]);
    });

    test("the row is not touched when it is gone by the time the answer comes", async () => {
        currentRetry = newRetry();
        const task = m.makeTask([
            row("soulseek", "skipped", { providerDetail: "A", retryPayload: { id: "A" } }),
            row("soulseek", "skipped", { providerDetail: "B", retryPayload: { id: "B" } }),
        ]);
        const retrying = task.retryDownloadSource(0);
        await retry.started;

        task.updateAttributes({ downloadSources: rowsOf(task).slice(1) }); // A removed, B is at 0

        retry.finish(row("soulseek", "downloaded", { providerDetail: "A" }));
        await retrying;

        expect(names(task)).toEqual(["soulseek:B:skipped"]);
    });

    test("reject cancels the transfer of that row, wherever the row is now", async () => {
        currentRetry = newRetry();
        const task = m.makeTask([
            row("ytdlp", "downloaded", { providerDetail: "yt" }),
            row("soulseek", "skipped", { providerDetail: "A", retryPayload: { id: "A" } }),
            row("soulseek", "skipped", { providerDetail: "B", retryPayload: { id: "B" } }),
        ]);
        const cancelled: string[] = [];

        const retrying = task.retryDownloadSource(1);
        await retry.started;
        retry.announce(() => cancelled.push("A's transfer"));

        task.updateAttributes({ downloadSources: rowsOf(task).slice(1) });
        // Rejecting B (position 1) must not cancel A's transfer; rejecting A (position 0) must.
        task.rejectDownloadSource(1, true);
        expect(cancelled).toEqual([]);
        task.rejectDownloadSource(0, true);
        expect(cancelled).toEqual(["A's transfer"]);

        retry.finish(row("soulseek", "failed", { providerDetail: "A" }));
        await retrying;
        // Rejected stays rejected, whatever the transfer reports at its end.
        expect(rowsOf(task)[0].isRejected).toBe(true);
    });

    test("every row has a key of its own, and an update does not change it", async () => {
        currentRetry = newRetry();
        const task = m.makeTask([row("soulseek", "skipped", { providerDetail: "A", retryPayload: { id: "A" } })]);
        const retrying = task.retryDownloadSource(0);
        await retry.started;
        const key = rowsOf(task)[0].rowKey;
        expect(key).toBeTruthy();
        retry.announce(() => {});
        expect(rowsOf(task)[0].rowKey).toBe(key);
        retry.finish(row("soulseek", "downloaded", { providerDetail: "A" }));
        await retrying;
        expect(rowsOf(task)[0].rowKey).toBe(key);
    });
});
