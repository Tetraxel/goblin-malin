import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { dataFileNoticeBridge, type DataFileNotice } from "#base/bridges/dataFileNoticeBridge";
import { SessionStore } from "#sessions/sessionStore";
import type { StoredSession } from "#sessions/types";

let dir: string;
let file: string;
let notices: DataFileNotice[];

const session = (id: string): StoredSession => ({
    id,
    name: `Session ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    tasks: [],
});

const valid = (ids = ["a", "b", "c"], version: number | undefined = 1) =>
    JSON.stringify({ version, lastSessionId: ids[0] ?? null, sessions: ids.map(session) });

const siblings = (): string[] => fs.readdirSync(dir).filter((name) => name !== "sessions.json.tmp");
const withPrefix = (prefix: string): string[] => siblings().filter((name) => name.startsWith(prefix));

/** Load the file, then do the one normal write the app does right after boot. */
async function loadThenWrite(): Promise<SessionStore> {
    const store = new SessionStore(file);
    store.getAll();
    store.setLastSessionId(null);
    await store.flush();
    return store;
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-sessions-"));
    file = path.join(dir, "sessions.json");
    notices = [];
    dataFileNoticeBridge.reset();
    dataFileNoticeBridge.setOpener((n) => notices.push(n));
});

afterEach(() => {
    dataFileNoticeBridge.reset();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("SessionStore loading", () => {
    test("a valid file loads, writes back and raises nothing", async () => {
        fs.writeFileSync(file, valid());
        const store = await loadThenWrite();
        expect(store.getAll().map((s) => s.id)).toEqual(["a", "b", "c"]);
        expect(JSON.parse(fs.readFileSync(file, "utf-8")).sessions).toHaveLength(3);
        expect(notices).toEqual([]);
        expect(withPrefix("sessions.json.corrupt")).toEqual([]);
    });

    test("a missing file starts empty without a notice", async () => {
        const store = await loadThenWrite();
        expect(store.getAll()).toEqual([]);
        expect(notices).toEqual([]);
    });

    test("a UTF-8 BOM (Notepad, PowerShell 5) is stripped, not treated as damage", async () => {
        fs.writeFileSync(file, "﻿" + valid());
        const store = await loadThenWrite();
        expect(store.getAll()).toHaveLength(3);
        expect(notices).toEqual([]);
        expect(JSON.parse(fs.readFileSync(file, "utf-8")).sessions).toHaveLength(3);
    });

    test.each([
        ["truncated mid-file", valid().slice(0, 40)],
        ["empty", ""],
        ["whitespace only", "  \n"],
        ["null", "null"],
        ["an array", "[]"],
        ["an empty object", "{}"],
        ["sessions: null", '{"sessions":null}'],
        ["a string", '"hello"'],
    ])("%s: the file is set aside untouched, the user is told, nothing throws", async (_name, content) => {
        fs.writeFileSync(file, content);

        const store = await loadThenWrite();

        expect(store.getAll()).toEqual([]);
        const [quarantined] = withPrefix("sessions.json.corrupt-");
        expect(quarantined).toBeDefined();
        expect(fs.readFileSync(path.join(dir, quarantined), "utf-8")).toBe(content);
        expect(notices).toHaveLength(1);
        expect(notices[0].message).toContain(quarantined);
    });

    test("a damaged file is replaced by the copy from the previous launch", async () => {
        fs.writeFileSync(file, valid(["a", "b", "c"]));
        await loadThenWrite(); // a healthy launch leaves a .bak
        expect(fs.existsSync(file + ".bak")).toBe(true);

        fs.writeFileSync(file, valid().slice(0, 30)); // …then the file gets truncated
        const store = new SessionStore(file);

        expect(store.getAll().map((s) => s.id)).toEqual(["a", "b", "c"]);
        expect(notices).toHaveLength(1);
        expect(notices[0].message).toContain("restored");
        expect(withPrefix("sessions.json.corrupt-")).toHaveLength(1);
    });

    test("loading a damaged file does not overwrite the backup", async () => {
        fs.writeFileSync(file, valid(["a", "b", "c"]));
        await loadThenWrite();
        const backup = fs.readFileSync(file + ".bak", "utf-8");

        fs.writeFileSync(file, "{");
        await loadThenWrite();

        expect(fs.readFileSync(file + ".bak", "utf-8")).toBe(backup);
    });

    test("entries that aren't sessions are left out, and a copy of the original is kept", async () => {
        const raw = JSON.stringify({ version: 1, lastSessionId: null, sessions: [session("a"), 42, { id: 1 }] });
        fs.writeFileSync(file, raw);

        const store = await loadThenWrite();

        expect(store.getAll().map((s) => s.id)).toEqual(["a"]);
        const [copy] = withPrefix("sessions.json.corrupt-");
        expect(fs.readFileSync(path.join(dir, copy), "utf-8")).toBe(raw);
        expect(notices).toHaveLength(1);
    });

    test("a file from a newer version is kept as-is (unknown keys included) with a copy and one notice", async () => {
        const raw = JSON.stringify({ version: 99, future: { x: 1 }, lastSessionId: null, sessions: [session("a")] });
        fs.writeFileSync(file, raw);

        const store = await loadThenWrite();

        expect(store.getAll()).toHaveLength(1);
        expect(fs.readFileSync(file + ".from-v99", "utf-8")).toBe(raw);
        const written = JSON.parse(fs.readFileSync(file, "utf-8"));
        expect(written.version).toBe(99);
        expect(written.future).toEqual({ x: 1 });
        expect(notices).toHaveLength(1);

        // The next launch finds the copy already there and stays quiet.
        notices.length = 0;
        new SessionStore(file).getAll();
        expect(notices).toEqual([]);
    });

    test("a file without a version is read as version 1 and stamped on the next write", async () => {
        fs.writeFileSync(file, valid(["a"], undefined));
        await loadThenWrite();
        expect(JSON.parse(fs.readFileSync(file, "utf-8")).version).toBe(1);
        expect(notices).toEqual([]);
    });

    test("a file that exists but can't be read is never overwritten", async () => {
        fs.mkdirSync(file); // reading a directory fails with EISDIR, whatever the platform

        const store = new SessionStore(file);
        expect(store.getAll()).toEqual([]);
        store.upsertSession(session("new"));
        await store.flush();

        expect(fs.statSync(file).isDirectory()).toBe(true);
        expect(store.getAll().map((s) => s.id)).toEqual(["new"]); // still works in memory
        expect(notices).toHaveLength(1);
    });
});

describe("SessionStore backups", () => {
    test("the first write of a launch keeps the file as it was as .bak", async () => {
        fs.writeFileSync(file, valid(["a"]));
        const store = new SessionStore(file);
        store.upsertSession(session("b"));
        await store.flush();

        expect(JSON.parse(fs.readFileSync(file + ".bak", "utf-8")).sessions.map((s: StoredSession) => s.id)).toEqual([
            "a",
        ]);
        expect(store.getAll().map((s) => s.id)).toEqual(["b", "a"]);
    });

    test("later writes in the same launch leave the .bak alone", async () => {
        fs.writeFileSync(file, valid(["a"]));
        const store = new SessionStore(file);
        store.upsertSession(session("b"));
        await store.flush();
        store.upsertSession(session("c"));
        await store.flush();

        expect(JSON.parse(fs.readFileSync(file + ".bak", "utf-8")).sessions).toHaveLength(1);
    });
});

describe("notice bridge", () => {
    test("notices raised before the UI exists are delivered when it attaches", () => {
        dataFileNoticeBridge.reset(); // no UI yet
        fs.writeFileSync(file, "{");
        new SessionStore(file).getAll();

        const late: DataFileNotice[] = [];
        dataFileNoticeBridge.setOpener((n) => late.push(n));
        expect(late).toHaveLength(1);
    });
});

describe("SessionStore write failures", () => {
    // A directory sitting where the file should go makes the final rename fail, the way a locked file would.
    const blockTarget = () => fs.mkdirSync(file);
    const unblockTarget = () => fs.rmSync(file, { recursive: true, force: true });

    test("a failing write is reported once, kept in memory, and flush() gives up instead of hanging", async () => {
        const store = new SessionStore(file);
        store.getAll();
        blockTarget();

        store.upsertSession(session("a"));
        store.upsertSession(session("b"));
        const started = Date.now();
        const saved = await store.flush(400);

        expect(saved).toBe(false);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(store.getAll().map((s) => s.id)).toEqual(["b", "a"]);
        expect(notices).toHaveLength(1);
        expect(notices[0].title).toContain("couldn't be saved");
        // No temp files pile up behind the failure.
        expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });

    test("once the disk accepts the write again, flush() saves what was pending", async () => {
        const store = new SessionStore(file);
        store.getAll();
        blockTarget();
        store.upsertSession(session("a"));
        expect(await store.flush(300)).toBe(false);

        unblockTarget();
        expect(await store.flush()).toBe(true);
        expect(JSON.parse(fs.readFileSync(file, "utf-8")).sessions.map((s: StoredSession) => s.id)).toEqual(["a"]);
    });

    test("two stores on one file never share a temp file name", async () => {
        const first = new SessionStore(file);
        const second = new SessionStore(file);
        first.getAll();
        second.getAll();
        first.upsertSession(session("a"));
        second.upsertSession(session("b"));
        expect(await first.flush()).toBe(true);
        expect(await second.flush()).toBe(true);

        expect(() => JSON.parse(fs.readFileSync(file, "utf-8"))).not.toThrow();
        expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });
});
