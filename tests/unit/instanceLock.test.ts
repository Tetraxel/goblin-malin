import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// The lock lives in the data folder, resolved when #constants loads: point it at a throw-away folder first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-lock-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const { acquireInstanceLock, getLockPath, releaseInstanceLock, STALE_AFTER_MS } = await import("#utils/instanceLock");

beforeEach(() => fs.rmSync(getLockPath(), { force: true }));
afterEach(() => releaseInstanceLock());

describe("instance lock", () => {
    test("takes the lock, writes our pid, and removes it on release", () => {
        expect(acquireInstanceLock()).toEqual({ acquired: true });
        expect(fs.readFileSync(getLockPath(), "utf-8")).toBe(String(process.pid));

        releaseInstanceLock();
        expect(fs.existsSync(getLockPath())).toBe(false);
    });

    test("the lock appears with its pid already in it, and leaves no staging file behind (LOCK-02)", () => {
        expect(acquireInstanceLock()).toEqual({ acquired: true });
        expect(fs.readFileSync(getLockPath(), "utf-8")).toBe(String(process.pid));
        expect(fs.readdirSync(dataDir).filter((name) => name.endsWith(".new"))).toEqual([]);
    });

    test("refuses while another live process holds it", () => {
        // The parent process (the test runner) is certainly alive and is not us.
        fs.writeFileSync(getLockPath(), String(process.ppid));
        const result = acquireInstanceLock();

        expect(result).toEqual({ acquired: false, pid: process.ppid, lockPath: getLockPath() });
        // Not ours: a refused instance must leave the owner's lock alone.
        releaseInstanceLock();
        expect(fs.readFileSync(getLockPath(), "utf-8")).toBe(String(process.ppid));
    });

    test("takes over a lock left by a process that is gone", () => {
        fs.writeFileSync(getLockPath(), "2147483646");
        expect(acquireInstanceLock()).toEqual({ acquired: true });
        expect(fs.readFileSync(getLockPath(), "utf-8")).toBe(String(process.pid));
    });

    test("takes over an unreadable lock file", () => {
        fs.writeFileSync(getLockPath(), "not a pid");
        expect(acquireInstanceLock()).toEqual({ acquired: true });
    });

    test("a lock that nobody has touched for minutes is a leftover, even if its pid is alive (a reused pid)", () => {
        fs.writeFileSync(getLockPath(), String(process.ppid));
        const old = new Date(Date.now() - STALE_AFTER_MS - 60_000);
        fs.utimesSync(getLockPath(), old, old);

        expect(acquireInstanceLock({ graceMs: 300 })).toEqual({ acquired: true });
        expect(fs.readFileSync(getLockPath(), "utf-8")).toBe(String(process.pid));
    });

    test("an old lock whose owner touches it within the grace period (a machine that woke up) is kept", async () => {
        fs.writeFileSync(getLockPath(), String(process.ppid));
        const old = new Date(Date.now() - STALE_AFTER_MS - 60_000);
        fs.utimesSync(getLockPath(), old, old);

        // The owner, in another process, shows a sign of life while this one is waiting.
        const owner = spawn(process.execPath, [
            "-e",
            `setTimeout(() => { const n = new Date(); require("fs").utimesSync(${JSON.stringify(getLockPath())}, n, n); }, 300)`,
        ]);
        const exited = new Promise((resolve) => owner.on("exit", resolve));
        // The wait blocks this process, so the child's timer is what runs meanwhile.
        const result = acquireInstanceLock({ graceMs: 3000 });
        await exited;

        expect(result).toMatchObject({ acquired: false, pid: process.ppid });
        expect(fs.readFileSync(getLockPath(), "utf-8")).toBe(String(process.ppid));
    });

    test("a lock that was touched a moment ago still protects a live owner", () => {
        fs.writeFileSync(getLockPath(), String(process.ppid));
        const recent = new Date(Date.now() - 30_000);
        fs.utimesSync(getLockPath(), recent, recent);
        expect(acquireInstanceLock()).toMatchObject({ acquired: false, pid: process.ppid });
    });

    test("taking over a stale lock leaves nothing beside it", () => {
        fs.writeFileSync(getLockPath(), "2147483646");
        acquireInstanceLock();
        expect(fs.readdirSync(dataDir).filter((n) => n.includes("stale"))).toEqual([]);
    });
});
