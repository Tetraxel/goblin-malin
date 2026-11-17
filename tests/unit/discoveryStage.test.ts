import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DiscoveryContext } from "#flows/musicDownloadFlow/discoveryMetadataService";
import type { DiscoveryResult, TrackMetadata, TrackDownloadTask } from "#flows/musicDownloadFlow/types";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first,
// hence the dynamic imports below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-discovery-stage-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

/** Audit v0.2.3, "Running": RUN-06 (a slot held while waiting), RUN-07 (the empty-track fallback), DISC-01. */

const SONG_URL = "https://youtube.test/song1";

const meta = (platform: "spotify" | "youtube", id: string): TrackMetadata =>
    ({
        id,
        trackName: "Song",
        artists: [{ type: "artist", name: "Artist" }],
        duration: 200_000,
        url: `https://${platform}.test/${id}`,
        uri: `${platform.toUpperCase()}::TRACK::${id}`,
        platform,
        apiProvider: platform,
        fetchedAt: new Date(),
        type: "track",
    }) as unknown as TrackMetadata;

// What the fakes do, set by each test.
let primaryWorks: boolean;
let regularCalls: TrackMetadata[];
let lastResortCalls: TrackMetadata[];
let lastResortGate: Promise<void> | undefined;
let spotifySearchGate: Promise<void> | undefined;

type Mods = {
    DownloadTask: typeof DownloadTaskType;
    registries: () => {
        metadata: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
        discovery: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
        download: import("#base/service-registry").ServiceRegistry<DownloadTaskType, any>;
    };
    metadataLimiter: typeof import("#flows/musicDownloadFlow/utils/stageLimiters").metadataLimiter;
};
let m: Mods;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { MetadataService } = await import("#flows/musicDownloadFlow/metadataService");
    const { DiscoveryMetadataService } = await import("#flows/musicDownloadFlow/discoveryMetadataService");

    const reading = (platform: "spotify" | "youtube", host: string) =>
        class extends MetadataService {
            static parseUrl(url: string) {
                const u = new URL(url);
                if (u.host !== host) return null;
                const id = u.pathname.split("/").filter(Boolean).pop();
                return id ? { platform, type: "track" as const, id } : null;
            }
            constructor(task: DownloadTaskType, logger: never) {
                super(platform, task, logger);
            }
            async getTrackMetadata(url: string) {
                if (platform === "youtube" && !primaryWorks) throw new Error("the owning service is down");
                return meta(platform, new URL(url).pathname.split("/").filter(Boolean).pop()!);
            }
            async searchTrack() {
                await spotifySearchGate;
                return [];
            }
        };

    class FakeRegular extends DiscoveryMetadataService {
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeRegular", task, logger);
        }
        async discoverFromUri(src: TrackMetadata): Promise<DiscoveryResult> {
            regularCalls.push(src);
            return { tracks: [meta("youtube", "song1")] };
        }
    }
    class FakeLastResort extends DiscoveryMetadataService {
        static readonly lastResort = true;
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeLastResort", task, logger);
        }
        async discoverFromUri(src: TrackMetadata, _context?: DiscoveryContext): Promise<DiscoveryResult> {
            lastResortCalls.push(src);
            await lastResortGate;
            return { tracks: [] };
        }
    }

    m = {
        DownloadTask: (await import("#flows/musicDownloadFlow/utils/downloadTask")).DownloadTask,
        registries: () => {
            const metadata = new ServiceRegistry<DownloadTaskType, any>();
            metadata
                .register("spotify", reading("spotify", "spotify.test") as never)
                .register("youtube", reading("youtube", "youtube.test") as never);
            const discovery = new ServiceRegistry<DownloadTaskType, any>();
            // Registered first, so the fallback meets the last-resort service before the regular one.
            discovery.register("claude", FakeLastResort as never).register("fake", FakeRegular as never);
            return { metadata, discovery, download: new ServiceRegistry<DownloadTaskType, any>() };
        },
        metadataLimiter: (await import("#flows/musicDownloadFlow/utils/stageLimiters")).metadataLimiter,
    };
    const { SettingsStore } = await import("#settings/settingsStore");
    SettingsStore.getInstance().patchMusicSettings({ musicBrainz: { matchTracks: false } });
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => {
    primaryWorks = true;
    regularCalls = [];
    lastResortCalls = [];
    lastResortGate = undefined;
    spotifySearchGate = undefined;
});

function attributes(over: Partial<TrackDownloadTask> = {}): TrackDownloadTask {
    return {
        kind: "track",
        state: "pending",
        userInput: { type: "url", url: SONG_URL },
        uri: { platform: "youtube", type: "track", id: "song1" },
        recognizedServiceKey: "youtube",
        metadataGroups: [],
        metadataOverride: {},
        downloadSources: [],
        toTag: true,
        toDownload: false,
        ...over,
    };
}

async function makeTask(id = "t1", attrs: TrackDownloadTask = attributes()) {
    const { globalLogger } = await import("#base/logger/logger");
    const r = m.registries();
    return new m.DownloadTask({
        id,
        initialInput: SONG_URL,
        attributes: attrs,
        logger: globalLogger,
        metadataServiceRegistry: r.metadata,
        discoveryServiceRegistry: r.discovery,
        downloadServiceRegistry: r.download,
        isMetadataServiceEnabled: () => true,
        isDiscoveryServiceEnabled: () => true,
        isDownloadServiceEnabled: () => true,
    });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("RUN-07: the fallback for primary metadata", () => {
    test("asks the regular discovery services with the link, never a last-resort one with an empty track", async () => {
        primaryWorks = false;
        const task = await makeTask();

        await task.startPrimaryMetadataFetching();

        expect(lastResortCalls).toEqual([]);
        expect(regularCalls).toHaveLength(1);
        expect(regularCalls[0]).toMatchObject({ trackName: "", url: SONG_URL });
        const primary = task.getAttributes()?.metadataGroups.flatMap((g) => g.results.filter((r) => r.isPrimaryInput));
        expect(primary?.[0]?.metadata.id).toBe("song1");
    });
});

describe("RUN-06: a slot is not held while a last-resort call runs", () => {
    test("other metadata work goes on while the last-resort service is out", async () => {
        const limiter = m.metadataLimiter;
        const before = limiter.getLimit();
        limiter.setLimit(1);
        try {
            let open!: () => void;
            lastResortGate = new Promise<void>((resolve) => (open = resolve));
            const task = await makeTask();
            const run = task.start();

            // Wait until the last-resort service is called (it blocks on the gate).
            for (let i = 0; i < 100 && lastResortCalls.length === 0; i++) await sleep(10);
            expect(lastResortCalls).toHaveLength(1);

            // The only metadata slot is free: this does not wait for the slow call.
            const other = await Promise.race([limiter.run(async () => "worked"), sleep(500).then(() => "blocked")]);
            expect(other).toBe("worked");

            open();
            await run;
            expect(task.getAttributes()?.state).toBe("finished");
        } finally {
            limiter.setLimit(before);
        }
    });
});

describe("DISC-01: a stage that was stopped did not discover", () => {
    test("metadataDiscovered stays down when the stage is stopped halfway", async () => {
        let open!: () => void;
        spotifySearchGate = new Promise<void>((resolve) => (open = resolve));
        const task = await makeTask("t2");
        await task.startPrimaryMetadataFetching();

        const controller = new AbortController();
        const stage = task.startMetadataDiscovering({ signal: controller.signal });
        await sleep(20);
        controller.abort();
        await stage;
        open();

        expect(task.getAttributes()?.metadataDiscovered).toBe(false);
        expect(task.getAttributes()?.metadataDiscoveringInProgress).toBe(false);
    });

    test("a stage that ran to its end is marked as discovered", async () => {
        const task = await makeTask("t3");
        await task.start();
        expect(task.getAttributes()?.metadataDiscovered).toBe(true);
    });
});
