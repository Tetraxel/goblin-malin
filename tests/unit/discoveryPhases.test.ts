import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DiscoveryContext } from "#flows/musicDownloadFlow/discoveryMetadataService";
import type { DiscoveryResult, SearchTrackResult, TrackMetadata } from "#flows/musicDownloadFlow/types";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first,
// hence the dynamic imports below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-discovery-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

// ── Fakes ────────────────────────────────────────────────────────────────────

const meta = (platform: "spotify" | "youtube", id: string, title: string, artist: string, durationMs = 200_000) =>
    ({
        id,
        trackName: title,
        artists: [{ type: "artist", name: artist }],
        duration: durationMs,
        url: `https://${platform}.test/${id}`,
        uri: `${platform.toUpperCase()}::TRACK::${id}`,
        platform,
        apiProvider: platform,
        fetchedAt: new Date(),
        type: "track",
    }) as unknown as TrackMetadata;

const PRIMARY = meta("spotify", "p1", "Get Lucky", "Daft Punk");

// What each fake platform "knows": url → what getTrackMetadata returns (absent → it throws).
let catalog: Record<string, TrackMetadata>;
// What the fake youtube search returns during Phase A.
let youtubeSearch: SearchTrackResult[];
// What the fake discovery services return, and how they were called.
let regularResult: DiscoveryResult;
let lastResortResult: DiscoveryResult;
let callOrder: string[];
let lastResortContexts: (DiscoveryContext | undefined)[];

type Mods = {
    DownloadTask: typeof DownloadTaskType;
    registries: () => {
        metadata: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
        discovery: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
        download: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
    };
};
let m: Mods;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { MetadataService } = await import("#flows/musicDownloadFlow/metadataService");
    const { DiscoveryMetadataService } = await import("#flows/musicDownloadFlow/discoveryMetadataService");

    class FakeSpotify extends MetadataService {
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSpotify", task, logger);
        }
        async getTrackMetadata(url: string) {
            return catalog[url] ?? Promise.reject(new Error(`unknown ${url}`));
        }
        async searchTrack() {
            return [];
        }
    }
    class FakeYoutube extends MetadataService {
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeYoutube", task, logger);
        }
        async getTrackMetadata(url: string) {
            return catalog[url] ?? Promise.reject(new Error(`unknown ${url}`));
        }
        async searchTrack() {
            return youtubeSearch;
        }
    }
    class FakeRegular extends DiscoveryMetadataService {
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeRegular", task, logger);
        }
        async discoverFromUri() {
            callOrder.push("regular");
            return regularResult;
        }
    }
    class FakeLastResort extends DiscoveryMetadataService {
        static readonly lastResort = true;
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeLastResort", task, logger);
        }
        async discoverFromUri(_src: TrackMetadata, context?: DiscoveryContext) {
            callOrder.push("lastResort");
            lastResortContexts.push(context);
            return lastResortResult;
        }
    }

    m = {
        DownloadTask: (await import("#flows/musicDownloadFlow/utils/downloadTask")).DownloadTask,
        registries: () => {
            const metadata = new ServiceRegistry<DownloadTaskType, any>();
            metadata.register("spotify", FakeSpotify as never).register("youtube", FakeYoutube as never);
            const discovery = new ServiceRegistry<DownloadTaskType, any>();
            discovery.register("regular", FakeRegular as never).register("claude", FakeLastResort as never);
            return { metadata, discovery, download: new ServiceRegistry<DownloadTaskType, any>() };
        },
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => {
    catalog = {};
    youtubeSearch = [];
    regularResult = { tracks: [] };
    lastResortResult = { tracks: [] };
    callOrder = [];
    lastResortContexts = [];
});

async function makeTask(opts: { lastResortEnabled?: boolean } = {}) {
    const { globalLogger } = await import("#base/logger/logger");
    const r = m.registries();
    const task = new m.DownloadTask({
        id: "t1",
        initialInput: PRIMARY.url,
        attributes: {
            kind: "track",
            state: "running",
            userInput: { type: "url", url: PRIMARY.url },
            metadataGroups: [
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 0,
                    results: [
                        {
                            metadata: PRIMARY,
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
            downloadSources: [],
            toTag: true,
            toDownload: false,
        },
        logger: globalLogger,
        metadataServiceRegistry: r.metadata,
        discoveryServiceRegistry: r.discovery,
        downloadServiceRegistry: r.download,
        isMetadataServiceEnabled: () => true,
        isDiscoveryServiceEnabled: (key) => key !== "claude" || opts.lastResortEnabled !== false,
        isDownloadServiceEnabled: () => true,
    });
    return task;
}

const youtubeResults = (task: DownloadTaskType) =>
    task.getAttributes()?.metadataGroups.find((g) => g.serviceKey === "youtube")?.results ?? [];

const claudeFound = (url: string, extra: Partial<TrackMetadata> = {}) =>
    ({ ...meta("youtube", "yt1", "", ""), url, fetchedBy: "claude", ...extra }) as TrackMetadata;

describe("last-resort discovery (Phase C)", () => {
    test("runs when a platform is still missing, told which, and a verified result is added as 'claude'", async () => {
        const url = "https://youtube.test/yt1";
        catalog[url] = meta("youtube", "yt1", "Get Lucky", "Daft Punk");
        lastResortResult = { tracks: [claudeFound(url)], searchKeys: ["trackName+artistName+isrc"] };

        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(lastResortContexts).toEqual([{ wantedPlatforms: ["youtube"] }]);
        const results = youtubeResults(task);
        expect(results).toHaveLength(1);
        expect(results[0].metadata.trackName).toBe("Get Lucky"); // the real, enriched metadata
        expect(results[0].discoverySources).toEqual([
            { discoveredBy: "claude", fromUri: PRIMARY.uri, searchKeys: ["trackName+artistName+isrc"] },
        ]);
    });

    test("is skipped when nothing is missing", async () => {
        youtubeSearch = [{ metadata: meta("youtube", "found", "Get Lucky", "Daft Punk"), searchKeys: ["trackName"] }];

        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(lastResortContexts).toEqual([]);
    });

    test("is skipped when the user hasn't enabled it", async () => {
        const task = await makeTask({ lastResortEnabled: false });
        await task.startMetadataDiscovering();

        expect(lastResortContexts).toEqual([]);
    });

    test("runs after the regular discovery services", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(callOrder).toEqual(["regular", "lastResort"]);
    });

    test("drops a link the platform can't confirm", async () => {
        lastResortResult = { tracks: [claudeFound("https://youtube.test/hallucinated")] };

        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(youtubeResults(task)).toHaveLength(0);
    });

    test("drops a link that resolves to a different recording", async () => {
        const url = "https://youtube.test/cover";
        catalog[url] = meta("youtube", "cover", "Get Lucky", "Some Cover Band", 150_000); // title only: 40%
        lastResortResult = { tracks: [claudeFound(url)] };

        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(youtubeResults(task)).toHaveLength(0);
    });
});

describe("regular discovery (Phase B) is unchanged", () => {
    test("a result that fails enrichment is still kept, flagged as an error", async () => {
        regularResult = {
            tracks: [{ ...meta("youtube", "yt9", "Get Lucky", "Daft Punk"), fetchedBy: "songlink" } as TrackMetadata],
        };

        const task = await makeTask();
        await task.startMetadataDiscovering();

        const results = youtubeResults(task);
        expect(results).toHaveLength(1);
        expect(results[0].fetchState).toBe("error");
        expect(results[0].discoverySources[0]).toMatchObject({ discoveredBy: "songlink", searchKeys: ["url"] });
    });
});
