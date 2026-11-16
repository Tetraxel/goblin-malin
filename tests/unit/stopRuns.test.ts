import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { TrackDownloadTask, TrackMetadata } from "#flows/musicDownloadFlow/types";

// "Stop" used to be checked only between the stages of a track: a call to a provider that took a while (or never
// answered) went on, and a track started by hand from the list could not be stopped at all.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-stop-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const URL_OF = "https://youtube.test/clip1";

// The fake platform: its answer never comes, and the test is told when it was asked.
let asked: () => void;
let wasAsked: Promise<void>;
const arm = () => {
    wasAsked = new Promise<void>((resolve) => (asked = resolve));
};

let m: {
    DownloadTask: typeof DownloadTaskType;
    orchestrator: import("#base/task/orchestrator").TaskOrchestrator;
    make: (over?: Partial<TrackDownloadTask>) => DownloadTaskType;
};

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { ServiceRegistry } = await import("#base/service-registry");
    const { MetadataService } = await import("#flows/musicDownloadFlow/metadataService");
    const { globalLogger } = await import("#base/logger/logger");
    const { DownloadTask } = await import("#flows/musicDownloadFlow/utils/downloadTask");
    const { TaskOrchestrator } = await import("#base/task/orchestrator");

    class Silent extends MetadataService {
        static parseUrl(url: string) {
            return new URL(url).host === "youtube.test"
                ? { platform: "youtube" as const, type: "track" as const, id: "clip1" }
                : null;
        }
        constructor(task: DownloadTaskType, logger: never) {
            super("youtube", task, logger);
        }
        async searchTrack() {
            return [];
        }
        getTrackMetadata(): Promise<TrackMetadata> {
            asked();
            return new Promise<TrackMetadata>(() => {});
        }
    }

    m = {
        DownloadTask,
        orchestrator: TaskOrchestrator.getInstance(),
        make: (over = {}) => {
            const metadata = new ServiceRegistry<DownloadTaskType, never>();
            metadata.register("youtube", Silent as never);
            const none = new ServiceRegistry<DownloadTaskType, never>();
            return new DownloadTask({
                id: "t1",
                initialInput: URL_OF,
                attributes: {
                    kind: "track",
                    state: "pending",
                    userInput: { type: "url", url: URL_OF },
                    uri: { platform: "youtube", type: "track", id: "clip1" },
                    recognizedServiceKey: "youtube",
                    metadataGroups: [],
                    metadataOverride: {},
                    downloadSources: [],
                    toTag: true,
                    toDownload: false,
                    ...over,
                } as TrackDownloadTask,
                logger: globalLogger,
                metadataServiceRegistry: metadata as never,
                discoveryServiceRegistry: none as never,
                downloadServiceRegistry: none as never,
                isMetadataServiceEnabled: () => true,
                isDiscoveryServiceEnabled: () => true,
                isDownloadServiceEnabled: () => true,
            });
        },
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
afterEach(() => m.orchestrator.setTasks([]));

const stateOf = (task: DownloadTaskType) => task.getAttributes()?.state;
/** Fails the test (instead of hanging it) when what should have ended is still going. */
const within = <T>(promise: Promise<T>, ms = 3000) =>
    Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("still running")), ms)),
    ]);

describe("Stop reaches the metadata stage", () => {
    test("a batch run stops while a provider has not answered", async () => {
        arm();
        const task = m.make();
        m.orchestrator.setTasks([task]);
        const batch = m.orchestrator.processTasks();
        await wasAsked;

        m.orchestrator.stopProcessing();

        await within(batch);
        expect(stateOf(task)).toBe("stopped");
        expect(m.orchestrator.isProcessing()).toBe(false);
    });

    test("a track started by hand stops too, with the same Stop", async () => {
        arm();
        const task = m.make();
        m.orchestrator.setTasks([task]);
        const run = task.start().catch(() => undefined);
        await wasAsked;
        expect(task.isBusy()).toBe(true);

        m.orchestrator.stopProcessing();

        await within(run);
        expect(stateOf(task)).toBe("stopped");
        expect(task.isBusy()).toBe(false);
    });

    test("Stop with nothing in a batch does not leave the orchestrator 'stopping'", () => {
        m.orchestrator.setTasks([m.make()]);
        m.orchestrator.stopProcessing();
        expect(m.orchestrator.isStopping()).toBe(false);
    });

    test("removing a task that runs ends its work: nothing could stop it afterwards", async () => {
        arm();
        const task = m.make();
        m.orchestrator.setTasks([task]);
        const run = task.start().catch(() => undefined);
        await wasAsked;

        m.orchestrator.removeTasks([task.getId()]);

        await within(run);
        expect(stateOf(task)).toBe("stopped");
    });

    test("a part run (re-fetch, download…) is stopped by the same means", async () => {
        const task = m.make({ state: "finished" });
        m.orchestrator.setTasks([task]);
        let seen: AbortSignal | undefined;
        const part = task.trackPartRun(async (signal) => {
            seen = signal;
            await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
            return "ended";
        });
        expect(seen?.aborted).toBe(false);
        expect(task.partRunning).toBe(true);

        m.orchestrator.stopProcessing();

        await expect(within(part)).resolves.toBe("ended");
        expect(seen?.aborted).toBe(true);
        expect(task.partRunning).toBe(false);
    });

    test("a start that was stopped can be started again (the stop is not remembered)", async () => {
        arm();
        const task = m.make();
        m.orchestrator.setTasks([task]);
        const first = task.start().catch(() => undefined);
        await wasAsked;
        task.abortRun();
        await within(first);
        expect(stateOf(task)).toBe("stopped");

        arm();
        const second = task.start().catch(() => undefined);
        await within(wasAsked);
        expect(stateOf(task)).toBe("running");
        task.abortRun();
        await within(second);
    });
});

describe("what a run rebuilds", () => {
    test("is emptied in one place, and what the user made stays", () => {
        const task = m.make({
            state: "finished",
            metadataOverride: { trackName: "My own title" } as never,
            primaryMetadataFetched: true,
            metadataDiscovered: true,
            downloadsFetched: true,
            downloadSources: [{ state: "downloaded" } as never],
        });
        task.resetForRerun();
        const attrs = task.getAttributes()!;
        expect(attrs.state).toBe("pending");
        expect(attrs.downloadSources).toEqual([]);
        expect(attrs.metadataGroups).toEqual([]);
        expect([attrs.primaryMetadataFetched, attrs.metadataDiscovered, attrs.downloadsFetched]).toEqual([
            false,
            false,
            false,
        ]);
        expect(attrs.metadataOverride).toEqual({ trackName: "My own title" });
    });
});
