import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
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

// â”€â”€ Fakes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// What each fake platform "knows": url â†’ what getTrackMetadata returns (absent â†’ it throws).
let catalog: Record<string, TrackMetadata>;
// What the fake youtube search returns during Phase A (or throws).
let youtubeSearch: SearchTrackResult[];
let youtubeError: Error | undefined;
// What the fake "slow" platform's search waits for (a promise the test settles), and who was asked, in order.
let slowSearch: Promise<SearchTrackResult[]> | undefined;
let searchCalls: string[];
// What the fake discovery services return, and how they were called.
let regularResult: DiscoveryResult;
let lastResortResult: DiscoveryResult;
let callOrder: string[];
let lastResortContexts: (DiscoveryContext | undefined)[];
let linkOnlySearched: number;

type Mods = {
    DownloadTask: typeof DownloadTaskType;
    registries: (withSlow?: boolean) => {
        metadata: import("#base/service-registry").ServiceRegistry<DownloadTaskType, never>;
        discovery: import("#base/service-registry").ServiceRegistry<DownloadTaskType, never>;
        download: import("#base/service-registry").ServiceRegistry<DownloadTaskType, never>;
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
            searchCalls.push("youtube");
            if (youtubeError) throw youtubeError;
            return youtubeSearch;
        }
    }
    // A platform whose search the test holds back, to see the others go on meanwhile.
    class FakeSlow extends MetadataService {
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSlow", task, logger);
        }
        async getTrackMetadata(url: string) {
            return catalog[url] ?? Promise.reject(new Error(`unknown ${url}`));
        }
        searchTrack() {
            searchCalls.push("slow");
            return slowSearch ?? Promise.resolve([]);
        }
    }
    // A platform read only through links (like Tidal): never searched, never a gap for the last resort.
    class FakeLinkOnly extends MetadataService {
        static readonly searchable = false;
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeLinkOnly", task, logger);
        }
        async getTrackMetadata(url: string) {
            return catalog[url] ?? Promise.reject(new Error(`unknown ${url}`));
        }
        async searchTrack() {
            linkOnlySearched++;
            return [];
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
        registries: (withSlow = false) => {
            const metadata = new ServiceRegistry<DownloadTaskType, never>();
            metadata
                .register("spotify", FakeSpotify as never)
                .register("youtube", FakeYoutube as never)
                .register("linkonly", FakeLinkOnly as never);
            if (withSlow) metadata.register("slow", FakeSlow as never);
            const discovery = new ServiceRegistry<DownloadTaskType, never>();
            discovery.register("regular", FakeRegular as never).register("claude", FakeLastResort as never);
            return { metadata, discovery, download: new ServiceRegistry<DownloadTaskType, never>() };
        },
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => {
    catalog = {};
    youtubeSearch = [];
    youtubeError = undefined;
    slowSearch = undefined;
    searchCalls = [];
    regularResult = { tracks: [] };
    lastResortResult = { tracks: [] };
    callOrder = [];
    lastResortContexts = [];
    linkOnlySearched = 0;
});

async function makeTask(opts: { lastResortEnabled?: boolean; slow?: boolean } = {}) {
    const { globalLogger } = await import("#base/logger/logger");
    const r = m.registries(opts.slow);
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

// The stage, then the user asking the last-resort service (the button under the sources).
const discoverThenAsk = async (task: DownloadTaskType) => {
    await task.startMetadataDiscovering();
    await task.startSingleProviderDiscovery("claude");
};

describe("last-resort discovery (only when the user asks)", () => {
    test("the discovery stage never runs it, even with a platform missing", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(lastResortContexts).toEqual([]);
        expect(callOrder).toEqual(["regular"]);
        expect(task.getLastResortOffers()).toEqual([{ key: "claude", missing: ["youtube"] }]);
    });

    test("asked, it is told which platform is missing, and a verified result is added as 'claude'", async () => {
        const url = "https://youtube.test/yt1";
        catalog[url] = meta("youtube", "yt1", "Get Lucky", "Daft Punk");
        lastResortResult = { tracks: [claudeFound(url)], searchKeys: ["trackName+artistName+isrc"] };

        const task = await makeTask();
        await discoverThenAsk(task);

        expect(lastResortContexts).toEqual([{ wantedPlatforms: ["youtube"] }]);
        const results = youtubeResults(task);
        expect(results).toHaveLength(1);
        expect(results[0].metadata.trackName).toBe("Get Lucky"); // the real, enriched metadata
        expect(results[0].discoverySources).toEqual([
            { discoveredBy: "claude", fromUri: PRIMARY.uri, searchKeys: ["trackName+artistName+isrc"] },
        ]);
    });

    test("what the service was asked travels to the source, and the score's parts to the result", async () => {
        const url = "https://youtube.test/yt1";
        catalog[url] = meta("youtube", "yt1", "Get Lucky", "Daft Punk");
        lastResortResult = {
            tracks: [claudeFound(url)],
            query: [{ label: "Search", value: '"Get Lucky" by Daft Punk' }],
        };

        const task = await makeTask();
        await discoverThenAsk(task);

        const [result] = youtubeResults(task);
        expect(result.discoverySources[0].query).toEqual([{ label: "Search", value: '"Get Lucky" by Daft Punk' }]);
        expect(result.confidenceParts?.map((p) => p.label)).toEqual(["Title", "Artist", "Duration", "Year"]);
        expect(result.confidenceParts?.reduce((sum, p) => sum + p.points, 0)).toBe(result.confidence);
    });

    test("a search service's query travels to the source its result becomes (Phase A)", async () => {
        youtubeSearch = [
            {
                metadata: meta("youtube", "found", "Get Lucky", "Daft Punk"),
                searchKeys: ["trackName+artistName"],
                query: [{ label: "Search", value: "Get Lucky Daft Punk" }],
            },
        ];

        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(youtubeResults(task)[0].discoverySources[0]).toMatchObject({
            discoveredBy: "youtube",
            query: [{ label: "Search", value: "Get Lucky Daft Punk" }],
        });
    });

    test("the explanation Claude gave travels to the source the result becomes", async () => {
        const url = "https://youtube.test/yt1";
        catalog[url] = meta("youtube", "yt1", "Get Lucky", "Daft Punk");
        lastResortResult = {
            tracks: [claudeFound(url)],
            explanations: { "YOUTUBE::TRACK::yt1": "The official audio. Same title and duration." },
        };

        const task = await makeTask();
        await discoverThenAsk(task);

        expect(youtubeResults(task)[0].discoverySources[0]).toMatchObject({
            discoveredBy: "claude",
            explanation: "The official audio. Same title and duration.",
        });
    });

    test("a result without an explanation has no explanation field", async () => {
        const url = "https://youtube.test/yt1";
        catalog[url] = meta("youtube", "yt1", "Get Lucky", "Daft Punk");
        lastResortResult = { tracks: [claudeFound(url)] };

        const task = await makeTask();
        await discoverThenAsk(task);

        expect(youtubeResults(task)[0].discoverySources[0]).not.toHaveProperty("explanation");
    });

    test("a service that asks consent is offered even after a no: the click asks again", async () => {
        const { SettingsStore } = await import("#settings/settingsStore");
        const { ensureDiscoveryConsent } = await import("#flows/musicDownloadFlow/utils/discoveryConsent");
        const { discoveryServiceRegistry } = await import("#flows/musicDownloadFlow/registries");
        const { consentBridge } = await import("#base/bridges/consentBridge");
        const { DiscoveryMetadataService } = await import("#flows/musicDownloadFlow/discoveryMetadataService");
        class Gated extends DiscoveryMetadataService {
            static readonly consent = { title: "t", message: "m" };
            async discoverFromUri() {
                return { tracks: [] };
            }
        }
        discoveryServiceRegistry.register("claude", Gated as never);
        try {
            SettingsStore.getInstance().patchMusicSettings({
                metadata: { discoveryProviders: { claude: { enabled: false, consentAsked: true } } },
            });
            // Without `reask` the earlier "no" stands; with it the question is put again (nobody to ask here: false).
            const asked: string[] = [];
            const spy = vi.spyOn(consentBridge, "request").mockImplementation((req) => {
                asked.push(req.providerKey);
                req.allow();
                return true;
            });
            expect(await ensureDiscoveryConsent("claude")).toBe(false);
            expect(asked).toEqual([]);
            expect(await ensureDiscoveryConsent("claude", true)).toBe(true);
            expect(asked).toEqual(["claude"]);
            spy.mockRestore();
        } finally {
            discoveryServiceRegistry.unregister("claude");
        }
    });

    test("is not offered when nothing is missing", async () => {
        youtubeSearch = [{ metadata: meta("youtube", "found", "Get Lucky", "Daft Punk"), searchKeys: ["trackName"] }];

        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(task.getLastResortOffers()).toEqual([]);
    });

    test("a platform that cannot be searched is not searched, and is not a gap it is offered for", async () => {
        youtubeSearch = [{ metadata: meta("youtube", "found", "Get Lucky", "Daft Punk"), searchKeys: ["trackName"] }];

        const task = await makeTask();
        await task.startMetadataDiscovering();

        // "linkonly" has no result, but only youtube could have been missing.
        expect(linkOnlySearched).toBe(0);
        expect(task.getLastResortOffers()).toEqual([]);
    });

    test("is not offered while the regular search still runs (every platform is empty then)", async () => {
        const task = await makeTask();
        task.updateAttributes({ metadataDiscoveringInProgress: true });
        expect(task.getLastResortOffers()).toEqual([]);

        task.updateAttributes({ metadataDiscoveringInProgress: false, primaryMetadataInProgress: true });
        expect(task.getLastResortOffers()).toEqual([]);

        task.updateAttributes({ primaryMetadataInProgress: false });
        expect(task.getLastResortOffers().length).toBeGreaterThan(0);
    });

    test("is not offered when the user has switched it off", async () => {
        const task = await makeTask({ lastResortEnabled: false });
        await task.startMetadataDiscovering();

        expect(task.getLastResortOffers()).toEqual([]);
    });

    test("shows as in progress while it runs, and not any more once it answered", async () => {
        let answer: (r: DiscoveryResult) => void = () => undefined;
        const task = await makeTask();
        await task.startMetadataDiscovering();
        const pending = new Promise<DiscoveryResult>((resolve) => {
            answer = resolve;
        });
        const service = (
            task as unknown as {
                discoveryServices: { get: (k: string) => { discoverFromUri: () => Promise<DiscoveryResult> } };
            }
        ).discoveryServices.get("claude");
        service.discoverFromUri = () => pending;

        const run = task.startSingleProviderDiscovery("claude");
        await new Promise((r) => setTimeout(r, 0));
        expect(task.getAttributes()?.lastResortInProgress).toBe("claude");

        answer({ tracks: [] });
        await run;
        expect(task.getAttributes()?.lastResortInProgress).toBeUndefined();
    });

    test("drops a link the platform can't confirm", async () => {
        lastResortResult = { tracks: [claudeFound("https://youtube.test/hallucinated")] };

        const task = await makeTask();
        await discoverThenAsk(task);

        expect(youtubeResults(task)).toHaveLength(0);
    });

    test("drops a link that resolves to a different recording", async () => {
        const url = "https://youtube.test/cover";
        catalog[url] = meta("youtube", "cover", "Get Lucky", "Some Cover Band", 150_000); // title only: 40%
        lastResortResult = { tracks: [claudeFound(url)] };

        const task = await makeTask();
        await discoverThenAsk(task);

        expect(youtubeResults(task)).toHaveLength(0);
    });
});

const groupOf = (task: DownloadTaskType, key: string) =>
    task.getAttributes()?.metadataGroups.find((g) => g.serviceKey === key);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the platforms are searched at once, each shown in its group (Phase A)", () => {
    test("every platform is asked without waiting for the others, and shows as searching meanwhile", async () => {
        let finishSlow: (r: SearchTrackResult[]) => void = () => undefined;
        slowSearch = new Promise((resolve) => {
            finishSlow = resolve;
        });
        const task = await makeTask({ slow: true });

        const stage = task.startMetadataDiscovering();
        await tick();

        // youtube answered at once, and "slow" is still pending: both were asked before either finished.
        expect(searchCalls).toEqual(["youtube", "slow"]);
        expect(groupOf(task, "youtube")?.search).toBeUndefined();
        expect(groupOf(task, "slow")).toMatchObject({ search: "searching", results: [] });

        finishSlow([{ metadata: meta("youtube", "s1", "Get Lucky", "Daft Punk"), searchKeys: ["trackName"] }]);
        await stage;
        expect(groupOf(task, "slow")?.search).toBeUndefined();
        expect(groupOf(task, "slow")?.results).toHaveLength(1);
    });

    test("the groups are ranked in the platforms' order, whoever answers first", async () => {
        let finishYoutube: (r: SearchTrackResult[]) => void = () => undefined;
        const task = await makeTask({ slow: true });
        const youtube = (
            task as unknown as { metadataServices: { get: (k: string) => { searchTrack: () => Promise<unknown> } } }
        ).metadataServices.get("youtube");
        youtube.searchTrack = () =>
            new Promise((resolve) => {
                finishYoutube = resolve as typeof finishYoutube;
            });

        const stage = task.startMetadataDiscovering();
        await tick(); // "slow" has answered (nothing), youtube has not
        finishYoutube([]);
        await stage;

        const ranks = Object.fromEntries(task.getAttributes()!.metadataGroups.map((g) => [g.serviceKey, g.rank]));
        expect(ranks.youtube).toBeLessThan(ranks.slow);
    });

    test("a platform with no result keeps its group, empty and no longer searching", async () => {
        const task = await makeTask();
        await task.startMetadataDiscovering();

        expect(groupOf(task, "youtube")).toMatchObject({ results: [] });
        expect(groupOf(task, "youtube")?.search).toBeUndefined();
    });

    test("a platform that cannot be asked is shown as failed, and the others go on", async () => {
        youtubeError = new Error("rate limited");
        const task = await makeTask({ slow: true });
        await task.startMetadataDiscovering();

        expect(groupOf(task, "youtube")?.search).toBe("failed");
        expect(groupOf(task, "slow")?.search).toBeUndefined();
        expect(task.getAttributes()?.metadataDiscovered).toBe(true);
    });

    test("a platform can be skipped alone: the stage goes on without it, and its late answer adds nothing", async () => {
        let finishSlow: (r: SearchTrackResult[]) => void = () => undefined;
        slowSearch = new Promise((resolve) => {
            finishSlow = resolve;
        });
        const task = await makeTask({ slow: true });

        const stage = task.startMetadataDiscovering();
        await tick();
        task.skipPlatformSearch("slow");
        await stage;

        expect(groupOf(task, "slow")?.search).toBe("skipped");
        expect(task.getAttributes()?.metadataDiscovered).toBe(true);

        finishSlow([{ metadata: meta("youtube", "late", "Get Lucky", "Daft Punk"), searchKeys: ["trackName"] }]);
        await tick();
        expect(groupOf(task, "slow")?.results).toEqual([]);
        expect(groupOf(task, "slow")?.search).toBe("skipped");
    });

    test("ending the whole stage early leaves nothing 'searching'", async () => {
        slowSearch = new Promise(() => undefined);
        const task = await makeTask({ slow: true });

        const stage = task.startMetadataDiscovering();
        await tick();
        task.skipDiscovery();
        await stage;

        expect(task.getAttributes()?.metadataGroups.some((g) => g.search === "searching")).toBe(false);
        expect(groupOf(task, "slow")?.search).toBe("skipped");
    });

    test("a loaded task is not searching: what was cut off reads as skipped", async () => {
        const { reviveTaskDates } = await import("#flows/musicDownloadFlow/utils/reviveTaskDates");
        const task = await makeTask();
        const saved = {
            ...task.getAttributes()!,
            lastResortInProgress: "claude",
            metadataGroups: [
                {
                    platform: "youtube" as const,
                    serviceKey: "youtube",
                    rank: 0,
                    results: [],
                    search: "searching" as const,
                },
            ],
        };
        const revived = reviveTaskDates(saved) as ReturnType<DownloadTaskType["getAttributes"]>;

        expect(revived?.metadataGroups[0].search).toBe("skipped");
        expect(revived).not.toHaveProperty("lastResortInProgress");
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
