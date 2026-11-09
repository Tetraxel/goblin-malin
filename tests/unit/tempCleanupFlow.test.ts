import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Task } from "#base/task/task";
import type { MusicDownloadTaskAttributes, TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import type { StoredSession } from "#sessions/types";
import type { TempCleanupChoice, TempCleanupView } from "#base/bridges/tempCleanupBridge";

// The clean-up end to end, against the real stores: what is asked, what is deleted, what happens to the
// sessions that pointed at deleted files, and that the UI is always released. The data folder is pointed at a
// throw-away directory before anything resolves #constants (hence the dynamic imports).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cleanup-test-data-"));
process.env.GOBLIN_DATA_DIR = dataDir;

type Mods = {
    TaskCtor: typeof Task;
    logger: typeof import("#base/logger/logger").globalLogger;
    orchestrator: import("#base/task/orchestrator").TaskOrchestrator;
    manager: import("#sessions/sessionManager").SessionManager;
    store: import("#sessions/sessionStore").SessionStore;
    settings: import("#settings/settingsStore").SettingsStore;
    bridge: typeof import("#base/bridges/tempCleanupBridge").tempCleanupBridge;
    flow: typeof import("#flows/musicDownloadFlow/tempCleanupFlow");
    getMusicSettings: typeof import("#flows/musicDownloadFlow/settings").getMusicSettings;
};
let m: Mods;

const roots: string[] = [dataDir];
const DAY = 24 * 3600 * 1000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    m = {
        TaskCtor: (await import("#base/task/task")).Task,
        logger: (await import("#base/logger/logger")).globalLogger,
        orchestrator: (await import("#base/task/orchestrator")).TaskOrchestrator.getInstance(),
        manager: (await import("#sessions/sessionManager")).SessionManager.getInstance(),
        store: (await import("#sessions/sessionStore")).SessionStore.getInstance(),
        settings: (await import("#settings/settingsStore")).SettingsStore.getInstance(),
        bridge: (await import("#base/bridges/tempCleanupBridge")).tempCleanupBridge,
        flow: await import("#flows/musicDownloadFlow/tempCleanupFlow"),
        getMusicSettings: (await import("#flows/musicDownloadFlow/settings")).getMusicSettings,
    };
});

afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

// ── fixtures ────────────────────────────────────────────────────────────────

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tempName = (n: number, ext = "flac") => `YtDlp YOUTUBE-TRACK-abc ${uuid(n)}.${ext}`;

let output: string;
let temp: string;

/** A temp file, last written `ageMs` ago. */
function tempFile(n: number, ageMs: number, ext = "flac"): string {
    const file = path.join(temp, tempName(n, ext));
    fs.writeFileSync(file, "x".repeat(10));
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(file, when, when);
    return file;
}

const source = (filePath: string): TrackDownloadSource =>
    ({
        state: "downloaded",
        provider: "ytdlp",
        selected: true,
        downloadedAt: new Date().toISOString(),
        localFile: { state: "found", path: filePath, name: path.basename(filePath, ".flac"), extension: "flac" },
    }) as unknown as TrackDownloadSource;

function trackSnapshot(id: string, filePaths: string[]) {
    const attributes = {
        kind: "track",
        state: "finished",
        userInput: { type: "url", url: id },
        metadataGroups: [],
        metadataOverride: { trackName: id, artists: [{ id: "a", name: "A" }] },
        downloadSources: filePaths.map(source),
    } as unknown as MusicDownloadTaskAttributes;
    return new m.TaskCtor({ id, attributes, logger: m.logger }).get() as unknown as StoredSession["tasks"][number];
}

/** A stored session pointing at the given temp files, last used `usedAgo` ago. */
function storeSession(id: string, filePaths: string[], usedAgo: number): void {
    m.store.upsertSession({
        id,
        name: id,
        createdAt: iso(usedAgo + 100 * DAY),
        updatedAt: iso(usedAgo),
        lastUsedAt: iso(usedAgo),
        tasks: [trackSnapshot(`${id}-track`, filePaths)],
    });
}

const stateOf = (sessionId: string): string | undefined => {
    const attrs = m.store.getById(sessionId)?.tasks[0].attributes as unknown as MusicDownloadTaskAttributes;
    return attrs.kind === "track" ? attrs.downloadSources[0].localFile?.state : undefined;
};
const present = (n: number) => fs.existsSync(path.join(temp, tempName(n)));

/** A stand-in for the modal: records every view and answers the questions the way the test says. */
function fakeUi(answer: (view: Extract<TempCleanupView, { kind: "choose" }>) => TempCleanupChoice) {
    const seen: TempCleanupView[] = [];
    m.bridge.setMounted(true);
    const unsubscribe = m.bridge.subscribe(() => {
        const view = m.bridge.get();
        if (!view) return;
        seen.push(view);
        if (view.kind === "choose") queueMicrotask(() => view.answer(answer(view)));
        if (view.kind === "message") queueMicrotask(view.close);
    });
    return {
        seen,
        kinds: () => seen.map((v) => v.kind),
        stop: () => {
            unsubscribe();
            m.bridge.setMounted(false);
        },
    };
}

let ui: ReturnType<typeof fakeUi> | null = null;

beforeEach(() => {
    output = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cleanup-test-out-"));
    roots.push(output);
    temp = path.join(output, "tmp");
    fs.mkdirSync(temp);
    m.settings.writeMusicSettings({ download: { outputDir: output, outputTemporaryDir: temp } });
    m.manager.newSession();
    m.orchestrator.setTasks([]);
    for (const s of m.store.getAll()) m.store.deleteSession(s.id);
});

afterEach(() => {
    ui?.stop();
    ui = null;
    m.bridge.close();
});

// ── the manual clean-up ─────────────────────────────────────────────────────

describe("manual clean-up", () => {
    test("deletes what the chosen age allows, keeps what a recently used session needs, and marks the rest", async () => {
        const oldUsed = tempFile(1, 40 * DAY); // only an old session uses it → goes
        const recentlyUsed = tempFile(2, 40 * DAY); // an old file, but a session opened an hour ago → stays
        const orphan = tempFile(3, 40 * DAY); // nobody uses it, old → goes
        const freshOrphan = tempFile(4, 3600 * 1000); // nobody uses it, an hour old → stays
        storeSession("old", [oldUsed], 40 * DAY);
        storeSession("recent", [recentlyUsed], 3600 * 1000);
        const before = m.store.getById("old")!;
        ui = fakeUi(() => ({ action: "clean", ageKey: "7d" }));

        expect(await m.flow.runTempCleanup("manual")).toBe("cleaned");

        expect([1, 2, 3, 4].map(present)).toEqual([false, true, false, true]);
        expect(fs.existsSync(orphan)).toBe(false);
        expect(fs.existsSync(freshOrphan)).toBe(true);
        // Nothing keeps offering a file that is gone: the sessions say so, and only where it is true.
        expect(stateOf("old")).toBe("not_found");
        expect(stateOf("recent")).toBe("found");
        // Cleaning is not a use of the session, and not an edit of it.
        const after = m.store.getById("old")!;
        expect(after.updatedAt).toBe(before.updatedAt);
        expect(after.lastUsedAt).toBe(before.lastUsedAt);
        // The dialog showed what each age would do, then worked behind a progress box, then reported.
        expect(ui.kinds()).toContain("choose");
        expect(ui.kinds()).toContain("working");
        expect(ui.kinds().at(-1)).toBe("message");
        const choose = ui.seen.find((v) => v.kind === "choose");
        expect(choose?.kind === "choose" && choose.options.find((o) => o.key === "7d")).toMatchObject({ files: 2 });
        // …and the UI is free again.
        expect(m.bridge.get()).toBeNull();
        // The age picked is what the dialog starts on next time.
        expect(m.getMusicSettings().download.tempCleanupAge).toBe("7d");
    });

    test("deletes nothing when the user says later", async () => {
        const file = tempFile(1, 40 * DAY);
        storeSession("old", [file], 40 * DAY);
        ui = fakeUi(() => ({ action: "later" }));

        expect(await m.flow.runTempCleanup("manual")).toBe("declined");

        expect(fs.existsSync(file)).toBe(true);
        expect(stateOf("old")).toBe("found");
        expect(m.bridge.get()).toBeNull();
    });

    test("deletes nothing when no UI is there to ask", async () => {
        const file = tempFile(1, 40 * DAY);
        expect(await m.flow.runTempCleanup("manual")).toBe("declined");
        expect(fs.existsSync(file)).toBe(true);
    });

    test("a downloaded file and its yt-dlp leftovers go together, and the source is marked once", async () => {
        const main = tempFile(1, 40 * DAY);
        const leftover = tempFile(1, 40 * DAY, "f251.webm.part");
        storeSession("old", [main], 40 * DAY);
        ui = fakeUi(() => ({ action: "clean", ageKey: "7d" }));

        await m.flow.runTempCleanup("manual");

        expect(fs.existsSync(main)).toBe(false);
        expect(fs.existsSync(leftover)).toBe(false);
        expect(stateOf("old")).toBe("not_found");
    });

    test("the session open now is never cleaned under the user — unless they ask for everything", async () => {
        const file = tempFile(1, 40 * DAY);
        storeSession("open", [file], 40 * DAY);
        m.manager.loadSession("open"); // opening it is a use, and the queue now holds its task
        ui = fakeUi(() => ({ action: "clean", ageKey: "12h" }));

        expect(await m.flow.runTempCleanup("manual")).toBe("nothing");
        expect(fs.existsSync(file)).toBe(true);
        ui.stop();

        ui = fakeUi(() => ({ action: "clean", ageKey: "all" }));
        expect(await m.flow.runTempCleanup("manual")).toBe("cleaned");
        expect(fs.existsSync(file)).toBe(false);
        // The open task itself is told, not just the stored copy.
        const live = m.orchestrator.getTasks()[0].getAttributes() as unknown as MusicDownloadTaskAttributes;
        expect(live.kind === "track" && live.downloadSources[0].localFile?.state).toBe("not_found");
        expect(stateOf("open")).toBe("not_found");
    });

    test("never touches a file that was just written, even for 'Everything'", async () => {
        const justNow = tempFile(1, 5_000);
        ui = fakeUi(() => ({ action: "clean", ageKey: "all" }));
        expect(await m.flow.runTempCleanup("manual")).toBe("nothing");
        expect(fs.existsSync(justNow)).toBe(true);
    });

    test("refuses, explains and keeps the library when the temp folder is the output folder", async () => {
        fs.writeFileSync(path.join(output, "my-favourite-song.flac"), "x");
        const inLibrary = path.join(output, tempName(1));
        fs.writeFileSync(inLibrary, "x");
        m.settings.writeMusicSettings({ download: { outputDir: output, outputTemporaryDir: output } });
        ui = fakeUi(() => ({ action: "clean", ageKey: "all" }));

        expect(await m.flow.runTempCleanup("manual")).toBe("refused");

        expect(ui.seen.find((v) => v.kind === "message")).toMatchObject({ tone: "warning" });
        expect(ui.kinds()).not.toContain("choose");
        expect(fs.existsSync(inLibrary)).toBe(true);
        expect(fs.existsSync(path.join(output, "my-favourite-song.flac"))).toBe(true);
    });

    test("says so when there is nothing to clean", async () => {
        ui = fakeUi(() => ({ action: "clean", ageKey: "all" }));
        expect(await m.flow.runTempCleanup("manual")).toBe("nothing");
        expect(ui.seen.find((v) => v.kind === "message")).toMatchObject({ title: "Nothing to clean" });
        expect(m.bridge.get()).toBeNull();
    });

    test("releases the UI even when the clean-up blows up", async () => {
        tempFile(1, 40 * DAY);
        ui = fakeUi(() => ({ action: "clean", ageKey: "7d" }));
        const original = m.manager.markTempFilesDeleted.bind(m.manager);
        m.manager.markTempFilesDeleted = () => Promise.reject(new Error("disk on fire"));
        try {
            expect(await m.flow.runTempCleanup("manual")).toBe("failed");
        } finally {
            m.manager.markTempFilesDeleted = original;
        }
        expect(ui.seen.find((v) => v.kind === "message")).toMatchObject({ tone: "error" });
        expect(m.bridge.get()).toBeNull();
    });
});

// ── the reminder ────────────────────────────────────────────────────────────

describe("start-up reminder", () => {
    test("says nothing when nothing is old enough to mention", async () => {
        tempFile(1, 2 * DAY);
        ui = fakeUi(() => ({ action: "later" }));
        await m.flow.runStartupTempMaintenance();
        expect(ui.seen).toHaveLength(0);
    });

    test("suggests cleaning, then stays quiet for a day", async () => {
        tempFile(1, 20 * DAY);
        ui = fakeUi(() => ({ action: "later" }));

        await m.flow.runStartupTempMaintenance();
        expect(ui.kinds()).toEqual(["choose"]);
        expect(ui.seen[0]).toMatchObject({ mode: "reminder" });

        await m.flow.runStartupTempMaintenance();
        expect(ui.kinds()).toEqual(["choose"]); // not asked again
    });

    test("'don't remind me' switches the reminder off for good", async () => {
        const file = tempFile(1, 20 * DAY);
        ui = fakeUi(() => ({ action: "never" }));

        await m.flow.runStartupTempMaintenance();

        expect(m.getMusicSettings().download.tempCleanupReminder).toBe(false);
        expect(fs.existsSync(file)).toBe(true);
        m.settings.patchMusicSettings({ download: { tempCleanupRemindedAt: "" } });
        await m.flow.runStartupTempMaintenance();
        expect(ui.kinds()).toEqual(["choose"]); // the setting is off: no second question
    });

    test("does not remind when the setting is off", async () => {
        tempFile(1, 20 * DAY);
        m.settings.patchMusicSettings({ download: { tempCleanupReminder: false } });
        ui = fakeUi(() => ({ action: "later" }));
        await m.flow.runStartupTempMaintenance();
        expect(ui.seen).toHaveLength(0);
    });
});

// ── the automatic clean-up ──────────────────────────────────────────────────

describe("automatic clean-up (48 h)", () => {
    test("deletes what no session used for 48 h without asking, and marks the sources", async () => {
        const stale = tempFile(1, 5 * DAY);
        const used = tempFile(2, 5 * DAY);
        const recent = tempFile(3, 5 * 3600 * 1000);
        storeSession("stale", [stale], 5 * DAY);
        storeSession("used", [used], 3600 * 1000);
        m.settings.patchMusicSettings({ download: { autoDeleteUnusedTemp: true } });
        ui = fakeUi(() => ({ action: "later" }));

        await m.flow.runStartupTempMaintenance();

        expect([1, 2, 3].map(present)).toEqual([false, true, true]);
        expect(fs.existsSync(recent)).toBe(true);
        expect(stateOf("stale")).toBe("not_found");
        expect(stateOf("used")).toBe("found");
        // No question, but the UI was blocked while it worked, and is free now.
        expect(ui.kinds()).toContain("working");
        expect(ui.kinds()).not.toContain("choose");
        expect(m.bridge.get()).toBeNull();
    });

    test("stays out of the way (no box at all) when there is nothing to delete", async () => {
        tempFile(1, 3600 * 1000);
        m.settings.patchMusicSettings({ download: { autoDeleteUnusedTemp: true } });
        ui = fakeUi(() => ({ action: "later" }));
        await m.flow.runStartupTempMaintenance();
        expect(ui.seen).toHaveLength(0);
    });
});

// ── what Settings shows ─────────────────────────────────────────────────────

describe("temporary folder usage", () => {
    test("measures the app's files and how much has gone unused for a week", async () => {
        tempFile(1, 20 * DAY);
        tempFile(2, 1 * DAY);
        fs.writeFileSync(path.join(temp, "someone-elses.flac"), "x".repeat(500));

        const usage = await m.flow.getTempUsage(temp);

        expect(usage).toMatchObject({ ok: true, files: 2, bytes: 20, unusedFiles: 1, unusedBytes: 10 });
        expect(m.flow.describeTempUsage(usage)).toMatch(/20 B in 2 files, 10 B unused for 7 days$/);
    });

    test("says why when the folder can't be used, and never throws", async () => {
        const usage = await m.flow.getTempUsage(output); // the output folder itself
        expect(usage.ok).toBe(false);
        expect(m.flow.describeTempUsage(usage)).toMatch(/unavailable/);
        expect(m.flow.describeTempUsage(undefined)).toBe("calculating…");
    });
});

// ── sessions ────────────────────────────────────────────────────────────────

describe("opening a session", () => {
    test("counts as a use (without being an edit) and marks the files that vanished meanwhile", () => {
        const kept = tempFile(1, 40 * DAY);
        const gone = path.join(temp, tempName(2)); // never created: deleted by hand while the session was closed
        m.store.upsertSession({
            id: "s",
            name: "s",
            createdAt: iso(90 * DAY),
            updatedAt: iso(60 * DAY),
            lastUsedAt: iso(60 * DAY),
            tasks: [trackSnapshot("keep", [kept]), trackSnapshot("lost", [gone])],
        });

        m.manager.loadSession("s");

        const stored = m.store.getById("s")!;
        expect(Date.now() - Date.parse(stored.lastUsedAt!)).toBeLessThan(60_000);
        // Not an edit: `updatedAt` (list order) is where it was.
        expect(Date.now() - Date.parse(stored.updatedAt)).toBeGreaterThan(59 * DAY);
        const states = m.orchestrator
            .getTasks()
            .map((t) => t.getAttributes() as unknown as MusicDownloadTaskAttributes)
            .map((a) => (a.kind === "track" ? a.downloadSources[0].localFile?.state : undefined));
        expect(states).toEqual(["found", "not_found"]);
    });
});

describe("opening a session — more", () => {
    test("opening the session that is already open keeps the edits not yet written", () => {
        const file = tempFile(1, 40 * DAY);
        storeSession("open", [file], 1 * DAY);
        m.manager.loadSession("open");
        // An edit made a moment ago: still waiting in the debounce, not in the store yet.
        const edited = trackSnapshot("edited-track", [file]);
        m.manager.persistCurrent([edited]);

        m.manager.loadSession("open");

        expect(m.orchestrator.getTasks().map((t) => t.getId())).toEqual(["edited-track"]);
        expect(m.store.getById("open")!.tasks.map((t) => t.id)).toEqual(["edited-track"]);
    });

    test("a source relocated to a file outside the temp folder is left alone, even if that file is not there now", () => {
        const relocated = path.join(os.tmpdir(), "unplugged-drive", "song.flac");
        m.store.upsertSession({
            id: "s",
            name: "s",
            createdAt: iso(2 * DAY),
            updatedAt: iso(2 * DAY),
            tasks: [trackSnapshot("moved", [relocated])],
        });

        m.manager.loadSession("s");

        const attrs = m.orchestrator.getTasks()[0].getAttributes() as unknown as MusicDownloadTaskAttributes;
        expect(attrs.kind === "track" && attrs.downloadSources[0].localFile?.state).toBe("found");
    });
});

describe("marking after a partial deletion", () => {
    test("a download whose main file went while a leftover stayed is marked as gone", async () => {
        const main = tempFile(1, 40 * DAY);
        const leftover = tempFile(1, 40 * DAY, "f251.webm.part"); // stands in for a file that could not be deleted
        storeSession("old", [main], 40 * DAY);
        fs.rmSync(main);

        const { tempFileStem } = await import("#flows/musicDownloadFlow/utils/tempDownloads");
        await m.manager.markTempFilesDeleted(new Set([tempFileStem(main)!]));

        expect(fs.existsSync(leftover)).toBe(true);
        expect(stateOf("old")).toBe("not_found");
    });

    test("a source whose file is still on disk is not marked, whatever the clean-up went through", async () => {
        const main = tempFile(1, 40 * DAY);
        storeSession("old", [main], 40 * DAY);

        const { tempFileStem } = await import("#flows/musicDownloadFlow/utils/tempDownloads");
        await m.manager.markTempFilesDeleted(new Set([tempFileStem(main)!]));

        expect(stateOf("old")).toBe("found");
    });
});
