import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SavedFile, TrackMetadata } from "#flows/musicDownloadFlow/types";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first,
// hence the dynamic imports below.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-data-sessions-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

/** Audit v0.2.3, "Data and sessions": DATA-05 (a relocated saved file), DATA-06 (busy albums), DATA-07, DATA-09. */

const track = { id: "1", trackName: "Mode avion", fetchedAt: new Date().toISOString() } as unknown as TrackMetadata;
const saved: SavedFile = {
    path: "C:/Music/Mode avion.flac",
    writtenPath: "C:/Music/Mode avion.flac",
    savedAt: new Date("2026-01-01T00:00:00Z"),
    provider: "soulseek",
    track,
};

type Mods = {
    orchestrator: import("#base/task/orchestrator").TaskOrchestrator;
    makeTrack: typeof import("./helpers/agentWorld").makeTrack;
    installWorld: typeof import("./helpers/agentWorld").installWorld;
    isRelocatedSavedFile: typeof import("#flows/musicDownloadFlow/utils/savedSource").isRelocatedSavedFile;
    CollectionTask: typeof import("#flows/musicDownloadFlow/utils/collectionTask").CollectionTask;
    taskIdFromUrl: typeof import("#flows/musicDownloadFlow/utils/taskId").taskIdFromUrl;
    logger: typeof import("#base/logger/logger").globalLogger;
    SessionManager: typeof import("#sessions/sessionManager").SessionManager;
};
let m: Mods;

const ALBUM_TRACKS = [
    "https://fakealbum.test/track/a",
    "https://fakealbum.test/track/b",
    "https://fakealbum.test/track/c",
];

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { MetadataService } = await import("#flows/musicDownloadFlow/metadataService");
    const { metadataServiceRegistry } = await import("#flows/musicDownloadFlow/registries");

    // A service that can list an album: the three tracks above.
    class FakeAlbumService extends MetadataService {
        static parseUrl(url: string) {
            const u = new URL(url);
            if (u.host !== "fakealbum.test") return null;
            const id = u.pathname.split("/").filter(Boolean).pop();
            return id ? { platform: "spotify" as const, type: "track" as const, id } : null;
        }
        static async expandCollection() {
            return {
                kind: "album" as const,
                name: "An album",
                ownerName: "Someone",
                totalCount: ALBUM_TRACKS.length,
                trackUrls: ALBUM_TRACKS,
            };
        }
        constructor(task: never, logger: never) {
            super("fakealbum", task, logger);
        }
        async getTrackMetadata(): Promise<never> {
            throw new Error("not used");
        }
        async searchTrack(): Promise<never[]> {
            return [];
        }
    }
    metadataServiceRegistry.register("fakealbum", FakeAlbumService as never);

    const agentWorld = await import("./helpers/agentWorld");
    m = {
        orchestrator: (await import("#base/task/orchestrator")).TaskOrchestrator.getInstance(),
        makeTrack: agentWorld.makeTrack,
        installWorld: agentWorld.installWorld,
        isRelocatedSavedFile: (await import("#flows/musicDownloadFlow/utils/savedSource")).isRelocatedSavedFile,
        CollectionTask: (await import("#flows/musicDownloadFlow/utils/collectionTask")).CollectionTask,
        taskIdFromUrl: (await import("#flows/musicDownloadFlow/utils/taskId")).taskIdFromUrl,
        logger: (await import("#base/logger/logger")).globalLogger,
        SessionManager: (await import("#sessions/sessionManager")).SessionManager,
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => m.orchestrator.setTasks([]));

describe("DATA-05: a saved file the user relocated is not the app's to delete", () => {
    test("a file where the app wrote it is not relocated", () => {
        expect(m.isRelocatedSavedFile(saved)).toBe(false);
    });

    test("a path that differs from where the app wrote it is", () => {
        expect(m.isRelocatedSavedFile({ ...saved, path: "D:/Other library/Mode avion.flac" })).toBe(true);
    });

    test("a file saved before the app recorded where it wrote it counts as the app's own", () => {
        expect(m.isRelocatedSavedFile({ ...saved, writtenPath: undefined, path: "D:/Elsewhere.flac" })).toBe(false);
    });

    test("relocating keeps where the app wrote the file", () => {
        const task = m.makeTrack("t1", "Mode avion", { savedFile: saved });
        task.relocateSavedFile("D:/Other library/Mode avion.flac");
        const after = task.getAttributes()?.savedFile;
        expect(after?.path).toBe("D:/Other library/Mode avion.flac");
        expect(after?.writtenPath).toBe(saved.writtenPath);
        expect(after && m.isRelocatedSavedFile(after)).toBe(true);
    });
});

describe("DATA-06: an album with a busy track is archived whole or not at all", () => {
    test("nothing of the album moves while one of its tracks is busy", () => {
        const a = m.makeTrack("a", "A", { parentTaskId: "album" });
        const b = m.makeTrack("b", "B", { parentTaskId: "album", state: "running" });
        const album = new m.CollectionTask({
            id: "album",
            attributes: {
                kind: "collection",
                collectionKind: "album",
                state: "finished",
                userInput: { type: "url", url: "https://example.com/album" },
                childTaskIds: ["a", "b"],
            },
            logger: m.logger,
        });
        m.orchestrator.setTasks([album, a, b] as never);

        const manager = m.SessionManager.getInstance();
        expect(manager.archiveTasks(["album"])).toBe(0);
        expect(
            m.orchestrator
                .getTasks()
                .map((t) => t.getId())
                .sort()
        ).toEqual(["a", "album", "b"]);
    });
});

describe("DATA-07: a restart rebuilds the discovery cells with the rest", () => {
    const anchors = { songlink: { url: "https://song.link/x" }, musicBrainz: { id: "rec-1", url: "https://mb/x" } };

    test("resetForRerun drops the anchors with the groups", () => {
        const task = m.makeTrack("t1", "Song", { discoveryAnchors: anchors as never });
        expect(task.getAttributes()?.discoveryAnchors).toBeDefined();
        task.resetForRerun();
        expect(task.getAttributes()?.metadataGroups).toEqual([]);
        expect(task.getAttributes()?.discoveryAnchors).toBeUndefined();
    });

    test("a stopped task started again drops them too", async () => {
        const task = m.makeTrack("t1", "Song", {
            state: "stopped",
            toTag: false,
            toDownload: false,
            discoveryAnchors: anchors as never,
        });
        m.installWorld([task]);
        await task.start().catch(() => {});
        expect(task.getAttributes()?.discoveryAnchors).toBeUndefined();
    });
});

describe("DATA-09: the list says which tracks were left out because they are queued already", () => {
    function album(): InstanceType<Mods["CollectionTask"]> {
        return new m.CollectionTask({
            id: "album",
            attributes: {
                kind: "collection",
                collectionKind: "album",
                state: "pending",
                userInput: { type: "url", url: "https://fakealbum.test/album/1" },
                recognizedServiceKey: "fakealbum",
                childTaskIds: [],
            },
            logger: m.logger,
        });
    }

    // Every track of the album is in the queue already, so nothing new is spawned (and no pipeline runs).
    const queued = (urls: string[]) => urls.map((url) => m.makeTrack(m.taskIdFromUrl(url), "Queued"));

    test("the count and the status name them; the tracks stay where they were", async () => {
        const task = album();
        m.orchestrator.setTasks([task, ...queued(ALBUM_TRACKS)] as never);

        await task.start();

        const attrs = task.getAttributes();
        expect(attrs?.totalCount).toBe(3);
        expect(attrs?.alreadyQueued).toBe(3);
        expect(attrs?.childTaskIds).toEqual([]);
        expect(task.get().status?.message).toBe("3 tracks (3 already in the queue elsewhere)");
    });

    test("only the tracks that were left out are counted", async () => {
        const task = album();
        // The first track is queued already; the other two are new (their pipeline is not run in a test).
        m.orchestrator.setTasks([task, ...queued(ALBUM_TRACKS.slice(0, 1))] as never);
        const originalProcess = m.orchestrator.processTasks.bind(m.orchestrator);
        m.orchestrator.processTasks = (async () => {}) as never;
        try {
            await task.start();
        } finally {
            m.orchestrator.processTasks = originalProcess;
        }
        expect(task.getAttributes()?.alreadyQueued).toBe(1);
        expect(task.getAttributes()?.childTaskIds).toHaveLength(2);
    });

    test("nothing is said when nothing was left out", async () => {
        const task = album();
        m.orchestrator.setTasks([task] as never);
        const originalProcess = m.orchestrator.processTasks.bind(m.orchestrator);
        m.orchestrator.processTasks = (async () => {}) as never;
        try {
            await task.start();
        } finally {
            m.orchestrator.processTasks = originalProcess;
        }
        expect(task.getAttributes()?.alreadyQueued).toBeUndefined();
        expect(task.get().status?.message).toBe("3 tracks");
    });
});
