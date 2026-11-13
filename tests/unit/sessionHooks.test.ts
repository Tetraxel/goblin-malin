import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { StoredSession } from "#sessions/types";
import { mountHook, tick } from "./helpers/mountHook";

// The store writes under GOBLIN_DATA_DIR, resolved when #constants loads: point it at a temp folder before anything
// imports it (hence the dynamic imports).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-session-hooks-"));
process.env.GOBLIN_DATA_DIR = dataDir;

type Mods = {
    store: import("#sessions/sessionStore").SessionStore;
    useSessions: typeof import("#components/SessionsModal/useSessions").useSessions;
    useArchive: typeof import("#components/ArchiveModal/useArchive").useArchive;
    useArchivedCount: typeof import("#components/ArchiveModal/useArchive").useArchivedCount;
    useCurrentSessionName: typeof import("#components/Toolbar/useCurrentSessionName").useCurrentSessionName;
    manager: import("#sessions/sessionManager").SessionManager;
};
let m: Mods;

beforeAll(async () => {
    m = {
        store: (await import("#sessions/sessionStore")).SessionStore.getInstance(),
        manager: (await import("#sessions/sessionManager")).SessionManager.getInstance(),
        useSessions: (await import("#components/SessionsModal/useSessions")).useSessions,
        ...(await import("#components/ArchiveModal/useArchive")),
        ...(await import("#components/Toolbar/useCurrentSessionName")),
    };
});
afterAll(async () => {
    await m.store.flush();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

const session = (id: string, extra: Partial<StoredSession> = {}): StoredSession => ({
    id,
    name: `Session ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-01-0${id.length}T00:00:00.000Z`,
    tasks: [],
    ...extra,
});

describe("hooks that follow the sessions only re-render when what they show changed", () => {
    test("a closed sessions list ignores every save; an open one follows them", async () => {
        let renders = 0;
        const hook = mountHook<boolean, ReturnType<typeof m.useSessions>>((enabled) => {
            renders++;
            return m.useSessions("", enabled);
        }, false);
        await tick();
        const closedRenders = renders;
        expect(hook.current().sessions).toEqual([]);

        m.store.upsertSession(session("a"));
        m.store.upsertSession(session("ab"));
        await tick();
        expect(renders).toBe(closedRenders); // not one render for two saves
        expect(hook.current().sessions).toEqual([]);

        // Opening it shows the current content at once (no empty frame first).
        hook.rerender(true);
        expect(hook.current().sessions.map((s) => s.id)).toEqual(["ab", "a"]);

        m.store.upsertSession(session("abc"));
        await tick();
        expect(hook.current().sessions.map((s) => s.id)).toContain("abc");
    });

    test("the toolbar's archive count does not re-render for a save that leaves the count alone", async () => {
        let renders = 0;
        const hook = mountHook<null, number>(() => {
            renders++;
            return m.useArchivedCount();
        }, null);
        await tick();
        expect(hook.current()).toBe(0);
        const before = renders;

        m.store.upsertSession(session("a", { updatedAt: "2026-05-01T00:00:00.000Z" }));
        m.store.upsertSession(session("a", { updatedAt: "2026-05-02T00:00:00.000Z" }));
        await tick();
        expect(renders).toBe(before);
    });

    test("the toolbar's session name does not re-render for a save that leaves the name alone", async () => {
        let renders = 0;
        const hook = mountHook<null, string | null>(() => {
            renders++;
            return m.useCurrentSessionName();
        }, null);
        await tick();
        const before = renders;
        m.store.upsertSession(session("a", { updatedAt: "2026-06-01T00:00:00.000Z" }));
        m.store.upsertSession(session("a", { updatedAt: "2026-06-02T00:00:00.000Z" }));
        await tick();
        expect(renders).toBe(before);
        expect(hook.current()).toBeNull();
    });

    test("a closed archive builds nothing", async () => {
        const hook = mountHook<boolean, ReturnType<typeof m.useArchive>>((enabled) => m.useArchive("", enabled), false);
        await tick();
        expect(hook.current()).toEqual({ entries: [], total: 0 });
    });
});
