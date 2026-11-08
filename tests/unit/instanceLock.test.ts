import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// The lock lives in the data folder, resolved when #constants loads: point it at a throw-away folder first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-lock-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const { acquireInstanceLock, getLockPath, releaseInstanceLock } = await import("#utils/instanceLock");

beforeEach(() => fs.rmSync(getLockPath(), { force: true }));
afterEach(() => releaseInstanceLock());

describe("instance lock", () => {
    test("takes the lock, writes our pid, and removes it on release", () => {
        expect(acquireInstanceLock()).toEqual({ acquired: true });
        expect(fs.readFileSync(getLockPath(), "utf-8")).toBe(String(process.pid));

        releaseInstanceLock();
        expect(fs.existsSync(getLockPath())).toBe(false);
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
});
