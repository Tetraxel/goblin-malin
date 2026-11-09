import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DownloadUpdateCallback } from "#flows/musicDownloadFlow/downloadService";
import type { HiddenCandidate, TrackDownloadSource, TrackMetadata } from "#flows/musicDownloadFlow/types";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first,
// hence the dynamic imports below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-show-more-test-"));
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

const stub = (n: number): HiddenCandidate => ({
    providerDetail: `peer${n}`,
    candidate: { name: `file${n}.flac`, sizeBytes: n * 1000 },
    retryPayload: { n },
});

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

let m: {
    makeTask: (sources: TrackDownloadSource[]) => DownloadTaskType;
};

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { DownloadService } = await import("#flows/musicDownloadFlow/downloadService");
    const { globalLogger } = await import("#base/logger/logger");
    const { DownloadTask } = await import("#flows/musicDownloadFlow/utils/downloadTask");

    // Lists two results, the second ending the listing (it carries 25 more), then tries the first and
    // wins — the way Soulseek's service reports a search with more results than it lists.
    class FakeSoulseek extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSoulseek", task, logger);
        }
        async downloadTrack(meta: TrackMetadata, onUpdate?: DownloadUpdateCallback) {
            onUpdate?.(row("soulseek", "pending", { track: meta, ...stub(1) }), { attemptId: "a" });
            onUpdate?.(
                row("soulseek", "skipped", {
                    track: meta,
                    ...stub(2),
                    moreCandidates: Array.from({ length: 25 }, (_, i) => stub(i + 3)),
                }),
                { attemptId: "b" }
            );
            onUpdate?.(row("soulseek", "downloading", { track: meta, ...stub(1) }), { attemptId: "a" });
            return row("soulseek", "downloaded", { track: meta, ...stub(1) });
        }
        // A manual download of one listed result: reports just that file, with no "more" marker of its own.
        async retryCandidate(meta: TrackMetadata, payload: unknown) {
            return row("soulseek", "downloaded", { track: meta, retryPayload: payload, providerDetail: "retried" });
        }
    }

    m = {
        makeTask: (sources) => {
            const download = new ServiceRegistry<DownloadTaskType, any>();
            download.register("soulseek", FakeSoulseek as never);
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
                    downloadsFetched: true,
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

describe("showMoreSources", () => {
    test("lists the next batch right under the row that ends the listing, and passes the rest on", () => {
        const task = m.makeTask([
            row("ytdlp", "downloaded"),
            row("soulseek", "skipped", { ...stub(1) }),
            row("soulseek", "skipped", {
                ...stub(2),
                moreCandidates: Array.from({ length: 25 }, (_, i) => stub(i + 3)),
            }),
            row("ytdlp", "failed"),
        ]);

        const added = task.showMoreSources(2, 10);

        const sources = sourcesOf(task);
        expect(added).toBe(10);
        expect(sources).toHaveLength(14);
        // The rows around the batch are untouched, in place.
        expect(sources[0].provider).toBe("ytdlp");
        expect(sources[13].provider).toBe("ytdlp");
        // The batch: peers 3..12, as not-needed rows of the same provider, carrying their own file.
        const batch = sources.slice(3, 13);
        expect(batch.map((s) => s.providerDetail)).toEqual(Array.from({ length: 10 }, (_, i) => `peer${i + 3}`));
        expect(batch.every((s) => s.provider === "soulseek" && s.state === "skipped" && !s.selected)).toBe(true);
        expect(batch[0].candidate?.name).toBe("file3.flac");
        expect(batch[0].retryPayload).toEqual({ n: 3 });
        // The "more" marker moved to the new last row, with 15 left.
        expect(sources[2].moreCandidates).toBeUndefined();
        expect(batch.slice(0, -1).every((s) => s.moreCandidates === undefined)).toBe(true);
        expect(batch[9].moreCandidates).toHaveLength(15);
    });

    test("the last batch removes the marker", () => {
        const task = m.makeTask([row("soulseek", "skipped", { ...stub(1), moreCandidates: [stub(2), stub(3)] })]);

        expect(task.showMoreSources(0, 10)).toBe(2);

        const sources = sourcesOf(task);
        expect(sources).toHaveLength(3);
        expect(sources.some((s) => s.moreCandidates !== undefined)).toBe(false);
    });

    test("does nothing for a row with nothing left to list", () => {
        const task = m.makeTask([row("soulseek", "skipped", stub(1))]);
        expect(task.showMoreSources(0)).toBe(0);
        expect(sourcesOf(task)).toHaveLength(1);
    });

    test("does nothing while a row is still being worked on (rows would shift under it)", () => {
        const task = m.makeTask([
            row("soulseek", "skipped", { ...stub(1), moreCandidates: [stub(2)] }),
            row("ytdlp", "downloading"),
        ]);

        expect(task.canShowMoreSources()).toBe(false);
        expect(task.showMoreSources(0)).toBe(0);
        expect(sourcesOf(task)).toHaveLength(2);
    });
});

describe("a listing's `moreCandidates`", () => {
    test("survives later updates to the row that carries it", async () => {
        // The fake lists two rows (the second carries the rest), then updates only the first.
        const task = m.makeTask([row("soulseek", "failed")]);

        await task.retryDownloadProvider("soulseek");

        const sources = sourcesOf(task);
        expect(sources.map((s) => s.state)).toEqual(["downloaded", "skipped"]);
        expect(sources[1].moreCandidates).toHaveLength(25);
    });

    test("survives a manual download of the row that carries it", async () => {
        const task = m.makeTask([row("soulseek", "failed")]);
        await task.retryDownloadProvider("soulseek");
        expect(sourcesOf(task)[1].moreCandidates).toHaveLength(25);

        await task.retryDownloadSource(1);

        const after = sourcesOf(task)[1];
        expect(after.state).toBe("downloaded");
        expect(after.providerDetail).toBe("retried");
        expect(after.moreCandidates).toHaveLength(25);
    });
});
