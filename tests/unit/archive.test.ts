import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Task } from "#base/task/task";
import type { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";
import type { StoredSession } from "#sessions/types";

// SessionStore writes under GOBLIN_DATA_DIR, resolved when #constants loads — so point it
// at a temp dir before anything imports the store (hence the dynamic imports below).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-archive-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

type Mods = {
    TaskCtor: typeof Task;
    logger: typeof import("#base/logger/logger").globalLogger;
    orchestrator: import("#base/task/orchestrator").TaskOrchestrator;
    manager: import("#sessions/sessionManager").SessionManager;
    store: import("#sessions/sessionStore").SessionStore;
    archive: typeof import("#sessions/archive");
};
let m: Mods;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    m = {
        TaskCtor: (await import("#base/task/task")).Task,
        logger: (await import("#base/logger/logger")).globalLogger,
        orchestrator: (await import("#base/task/orchestrator")).TaskOrchestrator.getInstance(),
        manager: (await import("#sessions/sessionManager")).SessionManager.getInstance(),
        store: (await import("#sessions/sessionStore")).SessionStore.getInstance(),
        archive: await import("#sessions/archive"),
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function trackAttrs(url: string, extra: Partial<MusicDownloadTaskAttributes> = {}): MusicDownloadTaskAttributes {
    return {
        kind: "track",
        state: "finished",
        userInput: { type: "url", url },
        metadataGroups: [],
        metadataOverride: { trackName: `Title of ${url}`, artists: [{ id: "a", name: "Some Artist" }] },
        downloadSources: [],
        ...extra,
    } as MusicDownloadTaskAttributes;
}

const savedSource = (filePath: string) => ({
    state: "downloaded",
    provider: "ytdlp",
    selected: true,
    downloadedAt: new Date().toISOString(),
    savedFile: { path: filePath, savedAt: new Date().toISOString() },
});

function makeTask(id: string, attributes: MusicDownloadTaskAttributes) {
    return new m.TaskCtor({ id, attributes, logger: m.logger }) as Task<MusicDownloadTaskAttributes>;
}

describe("archive helpers", () => {
    test("derives a display entry (artist, title, saved file) from a snapshot", () => {
        const task = makeTask("t1", trackAttrs("u1", { downloadSources: [savedSource("C:/music/a.mp3")] } as never));
        const sessions: StoredSession[] = [
            {
                id: "s",
                name: "S",
                createdAt: "",
                updatedAt: "",
                tasks: [],
                archived: [{ archivedAt: "2026-01-01T00:00:00.000Z", task: task.get() as never }],
            },
        ];

        const [entry] = m.archive.buildArchivedEntries(sessions);

        expect(entry).toMatchObject({
            taskId: "t1",
            artist: "Some Artist",
            title: "Title of u1",
            filePath: "C:/music/a.mp3",
        });
    });

    test("folds an archived collection's tracks into the parent row", () => {
        const parent = makeTask("p", {
            kind: "collection",
            childTaskIds: ["c1", "c2"],
            userInput: { url: "p" },
        } as never);
        const c1 = makeTask("c1", trackAttrs("c1"));
        const c2 = makeTask("c2", trackAttrs("c2"));
        const loner = makeTask("x", trackAttrs("x"));
        const archivedAt = "2026-01-01T00:00:00.000Z";
        const sessions = [
            {
                id: "s",
                name: "S",
                createdAt: "",
                updatedAt: "",
                tasks: [],
                archived: [parent, c1, c2, loner].map((t) => ({ archivedAt, task: t.get() as never })),
            },
        ] as StoredSession[];

        const entries = m.archive.buildArchivedEntries(sessions);

        expect(entries.map((e) => e.taskId).sort()).toEqual(["p", "x"]);
        expect(entries.find((e) => e.taskId === "p")?.childCount).toBe(2);
    });

    test("findSavedTaskIds returns idle saved tracks and fully-saved collections only", () => {
        const saved = makeTask("saved", trackAttrs("a", { downloadSources: [savedSource("f")] } as never));
        const unsaved = makeTask("unsaved", trackAttrs("b"));
        const running = makeTask("running", trackAttrs("c", { downloadSources: [savedSource("f")] } as never));
        running.running = true;
        const col = makeTask("col", { kind: "collection", childTaskIds: ["k1"], userInput: { url: "col" } } as never);
        const k1 = makeTask("k1", trackAttrs("k", { downloadSources: [savedSource("f")] } as never));
        const col2 = makeTask("col2", {
            kind: "collection",
            childTaskIds: ["k2"],
            userInput: { url: "col2" },
        } as never);
        const k2 = makeTask("k2", trackAttrs("k2"));

        const ids = m.archive.findSavedTaskIds([saved, unsaved, running, col, k1, col2, k2]);

        expect(ids.sort()).toEqual(["col", "k1", "saved"]);
    });
});

describe("SessionManager archive", () => {
    beforeEach(() => {
        m.manager.newSession();
        for (const s of m.store.getAll()) m.store.deleteSession(s.id);
    });

    test("archives out of the queue, persists in the session, and restores", () => {
        m.orchestrator.setTasks([makeTask("a", trackAttrs("a")), makeTask("b", trackAttrs("b"))]);

        expect(m.manager.archiveTasks(["a"])).toBe(1);

        expect(m.orchestrator.getTasks().map((t) => t.getId())).toEqual(["b"]);
        const sessionId = m.manager.getCurrentSessionId()!;
        expect(m.store.getById(sessionId)?.archived?.map((e) => e.task.id)).toEqual(["a"]);

        expect(m.manager.restoreArchived(sessionId, "a")).toBe(1);

        expect(
            m.orchestrator
                .getTasks()
                .map((t) => t.getId())
                .sort()
        ).toEqual(["a", "b"]);
        expect(m.store.getById(sessionId)?.archived).toEqual([]);
    });

    test("skips running tasks", () => {
        const running = makeTask("r", trackAttrs("r"));
        running.running = true;
        m.orchestrator.setTasks([running, makeTask("i", trackAttrs("i"))]);

        expect(m.manager.archiveTasks(["r", "i"])).toBe(1);

        expect(m.orchestrator.getTasks().map((t) => t.getId())).toEqual(["r"]);
    });

    test("archiving a collection takes its tracks, and restoring brings them back", () => {
        m.orchestrator.setTasks([
            makeTask("p", { kind: "collection", childTaskIds: ["c1"], userInput: { url: "p" } } as never),
            makeTask("c1", trackAttrs("c1")),
            makeTask("other", trackAttrs("o")),
        ]);

        expect(m.manager.archiveTasks(["p"])).toBe(2);
        expect(m.orchestrator.getTasks().map((t) => t.getId())).toEqual(["other"]);

        expect(m.manager.restoreArchived(m.manager.getCurrentSessionId()!, "p")).toBe(2);
        expect(
            m.orchestrator
                .getTasks()
                .map((t) => t.getId())
                .sort()
        ).toEqual(["c1", "other", "p"]);
    });

    test("a debounced task persist doesn't wipe the archive", () => {
        m.orchestrator.setTasks([makeTask("a", trackAttrs("a")), makeTask("b", trackAttrs("b"))]);
        m.manager.archiveTasks(["a"]);

        m.manager.persistCurrent(m.orchestrator.getTasks().map((t) => t.get()));
        // flush by switching away (loadSession/newSession flush pending writes first)
        const id = m.manager.getCurrentSessionId()!;
        m.manager.newSession();

        const session = m.store.getById(id)!;
        expect(session.tasks.map((t) => t.id)).toEqual(["b"]);
        expect(session.archived?.map((e) => e.task.id)).toEqual(["a"]);
    });

    test("deleteArchived removes the entry for good", () => {
        m.orchestrator.setTasks([makeTask("a", trackAttrs("a"))]);
        m.manager.archiveTasks(["a"]);
        const id = m.manager.getCurrentSessionId()!;

        m.manager.deleteArchived(id, "a");

        expect(m.store.getById(id)?.archived).toEqual([]);
    });
});
