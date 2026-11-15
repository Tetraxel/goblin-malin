import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { DownloadTrackOptions, DownloadUpdateCallback } from "#flows/musicDownloadFlow/downloadService";
import type { TrackDownloadSource, TrackMetadata } from "#flows/musicDownloadFlow/types";
import {
    DOWNLOAD_STRATEGY_KEYS,
    MAX_DOWNLOADS_PER_PROVIDER,
    maxDownloadsPerProvider,
    parseDownloadStrategy,
    stopsAtFirstDownload,
} from "#flows/musicDownloadFlow/utils/downloadStrategy";
import { itemRowHeight, type SettingsItem } from "#settings/buildSettingsItems";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first,
// hence the dynamic imports below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-download-strategy-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

describe("download strategy table", () => {
    test("an unknown stored value is the default (one file per provider)", () => {
        expect(parseDownloadStrategy(undefined)).toBe("each");
        expect(parseDownloadStrategy("everything")).toBe("each");
        for (const key of DOWNLOAD_STRATEGY_KEYS) expect(parseDownloadStrategy(key)).toBe(key);
    });

    test("only `all` downloads more than one file per provider, and never above the cap", () => {
        expect(maxDownloadsPerProvider("best")).toBe(1);
        expect(maxDownloadsPerProvider("each")).toBe(1);
        expect(maxDownloadsPerProvider("all")).toBe(MAX_DOWNLOADS_PER_PROVIDER);
        expect(MAX_DOWNLOADS_PER_PROVIDER).toBeLessThanOrEqual(5);
    });

    test("only `best` stops at the first provider that downloaded", () => {
        expect(DOWNLOAD_STRATEGY_KEYS.filter(stopsAtFirstDownload)).toEqual(["best"]);
    });
});

describe("itemRowHeight counts wrapped lines", () => {
    const textInput = (label: string, value = ""): SettingsItem => ({
        kind: "textInput",
        label,
        indent: 0,
        get: () => value,
        set: () => {},
    });

    test("without a width a row is one line (legacy behaviour)", () => {
        expect(itemRowHeight(textInput("x".repeat(500)))).toBe(1);
    });

    test("a label that fits is one line", () => {
        expect(itemRowHeight(textInput("Search timeout (ms)", "5000"), 78)).toBe(1);
    });

    test("a label longer than the list wraps onto more lines", () => {
        const long = "Market for searches (2-letter country code, e.g. FR; empty = your system's country)";
        expect(itemRowHeight(textInput(long), 78)).toBe(2);
    });

    test("an indented row has less room", () => {
        const label = "x".repeat(60);
        const row = (indent: number): SettingsItem => ({
            kind: "checkbox",
            label,
            indent,
            get: () => true,
            set: () => {},
        });
        expect(itemRowHeight(row(0), 70)).toBe(1);
        expect(itemRowHeight(row(10), 70)).toBe(2);
    });

    test("notes never wrap (they are cut), headers keep their blank line", () => {
        expect(itemRowHeight({ kind: "note", indent: 0, text: "x".repeat(500) }, 78)).toBe(1);
        expect(itemRowHeight({ kind: "sectionHeader", label: "Download" }, 78)).toBe(2);
    });
});

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
): TrackDownloadSource => ({ state, provider, track, downloadedAt: new Date(), selected: false, ...extra });

// What the fake providers saw: the options each was called with.
let ytdlpOptions: Array<DownloadTrackOptions | undefined> = [];
let soulseekOptions: Array<DownloadTrackOptions | undefined> = [];
let ytdlpOutcome: "downloaded" | "failed" = "downloaded";

let m: {
    DownloadTask: typeof DownloadTaskType;
    makeTask: () => DownloadTaskType;
    setStrategy: (value: string) => void;
};

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { DownloadService } = await import("#flows/musicDownloadFlow/downloadService");
    const { globalLogger } = await import("#base/logger/logger");
    const { DownloadTask } = await import("#flows/musicDownloadFlow/utils/downloadTask");
    const { SettingsStore } = await import("#settings/settingsStore");

    class FakeYtdlp extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeYtdlp", task, logger);
        }
        async downloadTrack(
            meta: TrackMetadata,
            onUpdate?: DownloadUpdateCallback,
            _signal?: AbortSignal,
            options?: DownloadTrackOptions
        ) {
            ytdlpOptions.push(options);
            onUpdate?.(row("ytdlp", "downloading", { track: meta }));
            return row("ytdlp", ytdlpOutcome, { track: meta });
        }
    }
    // Like Soulseek: five candidates, one row each; downloads until it has `maxDownloads` files.
    class FakeSoulseek extends DownloadService {
        compatibleMetadataProviders = ["youtube" as const];
        constructor(task: DownloadTaskType, logger: never) {
            super("FakeSoulseek", task, logger);
        }
        async downloadTrack(
            meta: TrackMetadata,
            onUpdate?: DownloadUpdateCallback,
            _signal?: AbortSignal,
            options?: DownloadTrackOptions
        ) {
            soulseekOptions.push(options);
            const ids = ["a", "b", "c", "d", "e"];
            ids.forEach((id) => onUpdate?.(row("soulseek", "pending", { track: meta }), { attemptId: id }));
            const max = options?.maxDownloads ?? 1;
            let last = "a";
            ids.forEach((id, i) => {
                const wins = i < max;
                onUpdate?.(row("soulseek", wins ? "downloaded" : "skipped", { track: meta }), { attemptId: id });
                if (wins) last = id;
            });
            // Like the real service: the winner's own row is addressed last, so the returned source lands on it.
            onUpdate?.(row("soulseek", "downloaded", { track: meta }), { attemptId: last });
            return row("soulseek", "downloaded", { track: meta });
        }
    }

    m = {
        DownloadTask,
        setStrategy: (value) =>
            SettingsStore.getInstance().patchMusicSettings({ download: { downloadStrategy: value } }),
        makeTask: () => {
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
                    downloadSources: [],
                    downloadsFetched: false,
                    toTag: true,
                    toDownload: true,
                },
                logger: globalLogger,
                metadataServiceRegistry: unused,
                discoveryServiceRegistry: unused,
                downloadServiceRegistry: download,
                isMetadataServiceEnabled: () => true,
                isDownloadServiceEnabled: () => true,
                isDiscoveryServiceEnabled: () => true,
            });
        },
    };
});

beforeEach(() => {
    ytdlpOptions = [];
    soulseekOptions = [];
    ytdlpOutcome = "downloaded";
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const summary = (task: DownloadTaskType) =>
    (task.getAttributes()?.downloadSources ?? []).map((s) => `${s.provider}:${s.state}`);

describe("startDownloads follows the download strategy", () => {
    test("each (the default): every provider is run, one file each", async () => {
        m.setStrategy("each");
        const task = m.makeTask();
        await task.startDownloads();

        expect(ytdlpOptions).toEqual([{ maxDownloads: 1 }]);
        expect(soulseekOptions).toEqual([{ maxDownloads: 1 }]);
        expect(summary(task).filter((s) => s === "soulseek:downloaded")).toHaveLength(1);
    });

    test("an unknown stored value behaves like each", async () => {
        m.setStrategy("nonsense");
        await m.makeTask().startDownloads();

        expect(soulseekOptions).toEqual([{ maxDownloads: 1 }]);
    });

    test("best: the first provider that downloads ends the search, the others get a 'not needed' row", async () => {
        m.setStrategy("best");
        const task = m.makeTask();
        await task.startDownloads();

        expect(ytdlpOptions).toHaveLength(1);
        expect(soulseekOptions).toHaveLength(0);
        expect(summary(task)).toEqual(["ytdlp:downloaded", "soulseek:skipped"]);
        expect(task.getAttributes()?.downloadsFetched).toBe(true);
    });

    test("best: when the first provider fails, the next one is used", async () => {
        m.setStrategy("best");
        ytdlpOutcome = "failed";
        const task = m.makeTask();
        await task.startDownloads();

        expect(soulseekOptions).toHaveLength(1);
        expect(summary(task)[0]).toBe("ytdlp:failed");
        expect(summary(task)).toContain("soulseek:downloaded");
    });

    test("best: the skipped provider can still be run by hand", async () => {
        m.setStrategy("best");
        const task = m.makeTask();
        await task.startDownloads();
        expect(task.canRetryDownloadProvider("soulseek")).toBe(true);

        await task.retryDownloadProvider("soulseek");

        expect(soulseekOptions).toHaveLength(1);
        expect(summary(task)).toContain("soulseek:downloaded");
    });

    test("all: a provider that can find several candidates is allowed the cap, never more", async () => {
        m.setStrategy("all");
        const task = m.makeTask();
        await task.startDownloads();

        expect(soulseekOptions).toEqual([{ maxDownloads: MAX_DOWNLOADS_PER_PROVIDER }]);
        const downloaded = summary(task).filter((s) => s === "soulseek:downloaded");
        expect(downloaded.length).toBeGreaterThan(1);
        expect(downloaded.length).toBeLessThanOrEqual(MAX_DOWNLOADS_PER_PROVIDER);
        // The single-file provider is still one download.
        expect(summary(task).filter((s) => s.startsWith("ytdlp"))).toEqual(["ytdlp:downloaded"]);
    });
});
