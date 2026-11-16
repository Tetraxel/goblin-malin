import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Task } from "#base/task/task";
import type { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

// The open task list must not be swapped under a run: the run's pump would start the other session's tasks by
// itself, drop the rest of its own, and leave what is in flight running with nowhere to save its result.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-switch-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

type Mods = {
    TaskCtor: typeof Task;
    logger: typeof import("#base/logger/logger").globalLogger;
    orchestrator: import("#base/task/orchestrator").TaskOrchestrator;
    manager: import("#sessions/sessionManager").SessionManager;
    store: import("#sessions/sessionStore").SessionStore;
    makeTrack: typeof import("./helpers/agentWorld").makeTrack;
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
        // After the data folder is set: the helper pulls in the whole app.
        makeTrack: (await import("./helpers/agentWorld")).makeTrack,
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const attrs = (url: string, state = "pending") =>
    ({
        kind: "track",
        state,
        userInput: { type: "url", url },
        metadataGroups: [],
        metadataOverride: {},
        downloadSources: [],
    }) as unknown as MusicDownloadTaskAttributes;

const makeTask = (id: string, state = "pending") =>
    new m.TaskCtor({ id, attributes: attrs(id, state), logger: m.logger }) as unknown as Task;

const listed = () => m.orchestrator.getTasks().map((t) => t.getId());

beforeEach(() => {
    m.orchestrator.setTasks([]);
    m.manager.newSession();
    for (const s of m.store.getAll()) m.store.deleteSession(s.id);
});

/** Saves `ids` as a session and returns its id; the open list is empty again afterwards. */
function saveSession(ids: string[]): string {
    m.orchestrator.setTasks(ids.map((id) => makeTask(id)));
    m.manager.persistCurrent(m.orchestrator.getTasks().map((t) => t.get()));
    m.manager.flushNow();
    const saved = m.store.getAll().find((s) => s.tasks.some((t) => t.id === ids[0]));
    m.manager.newSession();
    return saved!.id;
}

describe("replacing the task list while work is going on", () => {
    test("nothing is refused when nothing is running", () => {
        expect(m.manager.switchRefusal()).toBeUndefined();
    });

    test("a task in the 'running' state refuses opening, creating, duplicating and deleting the open session", () => {
        const other = saveSession(["b1"]);
        const mine = saveSession(["a1"]);
        m.manager.loadSession(mine);
        expect(listed()).toEqual(["a1"]);

        // A run is going on (a track started by hand has the state, and no flag on the orchestrator).
        m.orchestrator.setTasks([m.makeTrack("a1", "Song", { state: "running" })]);
        expect(m.manager.switchRefusal()).toMatch(/in progress/i);

        m.manager.loadSession(other);
        expect(listed()).toEqual(["a1"]);

        m.manager.newSession();
        expect(listed()).toEqual(["a1"]);

        m.manager.duplicateSession(other);
        expect(listed()).toEqual(["a1"]);
        expect(m.store.getAll().some((s) => s.name.startsWith("Copy of"))).toBe(false);

        m.manager.deleteSession(mine);
        expect(listed()).toEqual(["a1"]);
        expect(m.store.getById(mine)).toBeDefined();
    });

    test("a running task of the pump (the flag, not the state) refuses too", () => {
        const task = makeTask("a1");
        task.running = true;
        m.orchestrator.setTasks([task]);
        expect(m.manager.switchRefusal()).toBeDefined();
    });

    test("a task whose part (download, re-discover...) runs refuses too", async () => {
        const task = m.makeTrack("a1", "Song");
        m.orchestrator.setTasks([task]);
        let finish!: () => void;
        const part = task.trackPartRun(() => new Promise<void>((resolve) => (finish = resolve)));
        expect(m.manager.switchRefusal()).toBeDefined();
        finish();
        await part;
        expect(m.manager.switchRefusal()).toBeUndefined();
    });

    test("deleting another session is fine during a run", () => {
        const other = saveSession(["b1"]);
        m.orchestrator.setTasks([m.makeTrack("a1", "Song", { state: "running" })]);
        m.manager.deleteSession(other);
        expect(m.store.getById(other)).toBeUndefined();
    });

    test("once the work is over the switch goes through", () => {
        const other = saveSession(["b1"]);
        m.orchestrator.setTasks([makeTask("a1", "finished")]);
        m.manager.loadSession(other);
        expect(listed()).toEqual(["b1"]);
    });
});
