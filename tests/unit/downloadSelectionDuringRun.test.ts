import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DownloadUpdateCallback } from "#flows/musicDownloadFlow/downloadService";
import type { TrackDownloadSource, TrackMetadata } from "#flows/musicDownloadFlow/types";

// The user can pick a finished file while a slower provider is still working. The end of the run must not pick again.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-selection-test-"));
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

const downloaded = (provider: "ytdlp" | "soulseek", bitrateKbps: number): TrackDownloadSource => ({
    state: "downloaded",
    provider,
    track,
    downloadedAt: new Date(),
    selected: false,
    fileInfo: { format: "mp3", sizeBytes: 1000, durationMs: 200_000, bitrateKbps, embeddedTags: {} },
});

/** Set by a test: what the user does while the second provider is still working. */
let duringSecondProvider: ((task: DownloadTaskType) => void) | undefined;
let task: DownloadTaskType;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { DownloadService } = await import("#flows/musicDownloadFlow/downloadService");
    const { globalLogger } = await import("#base/logger/logger");
    const { DownloadTask } = await import("#flows/musicDownloadFlow/utils/downloadTask");

    class FirstProvider extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(owner: DownloadTaskType, logger: never) {
            super("FirstProvider", owner, logger);
        }
        async downloadTrack(_meta: TrackMetadata, onUpdate?: DownloadUpdateCallback) {
            const row = downloaded("ytdlp", 128);
            onUpdate?.(row);
            return row;
        }
    }
    // The slow one: the user acts while it works. Its own file is the better one, so the automatic choice is this.
    class SecondProvider extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(owner: DownloadTaskType, logger: never) {
            super("SecondProvider", owner, logger);
        }
        async downloadTrack() {
            duringSecondProvider?.(task);
            return downloaded("soulseek", 320);
        }
    }

    const registry = new ServiceRegistry<DownloadTaskType, never>();
    registry.register("ytdlp", FirstProvider as never).register("soulseek", SecondProvider as never);
    const unused = new ServiceRegistry<DownloadTaskType, never>();
    task = new DownloadTask({
        id: "t1",
        initialInput: track.url,
        attributes: {
            kind: "track",
            state: "running",
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
            downloadSources: [],
            downloadsFetched: false,
            toTag: true,
            toDownload: true,
        },
        logger: globalLogger,
        metadataServiceRegistry: unused as never,
        discoveryServiceRegistry: unused as never,
        downloadServiceRegistry: registry as never,
        isMetadataServiceEnabled: () => true,
        isDiscoveryServiceEnabled: () => true,
        isDownloadServiceEnabled: () => true,
    });
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const selectedProviders = () =>
    (task.getAttributes()?.downloadSources ?? []).filter((s) => s.selected).map((s) => s.provider);

describe("the automatic choice at the end of a download run", () => {
    test("picks the best file when the user chose nothing", async () => {
        duringSecondProvider = undefined;
        await task.startDownloads();
        expect(selectedProviders()).toEqual(["soulseek"]);
    });

    test("leaves the file the user picked while the run was going on", async () => {
        duringSecondProvider = (t) => t.selectDownloadSource(0);
        await task.startDownloads();
        expect(selectedProviders()).toEqual(["ytdlp"]);
        expect(task.getAttributes()?.downloadsFetched).toBe(true);
    });

    test("a new run starts clean, and chooses again", async () => {
        duringSecondProvider = undefined;
        await task.startDownloads();
        expect(selectedProviders()).toEqual(["soulseek"]);
    });
});
