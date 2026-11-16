import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import type { SearchResult } from "slsk-client";

// One Soulseek connection serves every task. A search that fails must not tear it down under the transfers of others.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-slsk-conn-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;
// So that logging in again does not open the setup wizard (the login itself is replaced in each test).
process.env.SOULSEEK_USERNAME = "user";
process.env.SOULSEEK_PASSWORD = "pass";

const { SoulseekService } =
    await import("#flows/musicDownloadFlow/services/download-providers/soulseek/SoulseekService");
const { Task } = await import("#base/task/task");
const { globalLogger } = await import("#base/logger/logger");

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
afterEach(() => {
    (SoulseekService as unknown as { client: unknown }).client = null;
});

type FakeClient = {
    downloads: unknown[];
    destroyed: number;
    destroy: () => void;
    search: () => Promise<SearchResult[]>;
};
const fakeClient = (search: () => Promise<SearchResult[]>, downloads: unknown[] = []): FakeClient => ({
    downloads,
    destroyed: 0,
    destroy() {
        this.destroyed++;
    },
    search,
});

type Internals = {
    searchOnce: (query: string, timeoutMs: number, signal?: AbortSignal) => Promise<SearchResult[]>;
    login: () => Promise<unknown>;
};

function service(current: FakeClient, next?: FakeClient) {
    (SoulseekService as unknown as { client: unknown }).client = current;
    const task = new Task({ id: "t1", attributes: {} as never, logger: globalLogger });
    const instance = new SoulseekService(task as never, globalLogger);
    (instance as unknown as Internals).login = async () => next;
    return instance as unknown as Internals;
}

const found = [{ user: "u", file: "f.flac" }] as unknown as SearchResult[];
const boom = () => Promise.reject(new Error("socket closed"));

describe("a failed Soulseek search", () => {
    test("does not destroy the connection while transfers are running on it", async () => {
        const client = fakeClient(boom, [{ running: true }]);
        const instance = service(client);

        await expect(instance.searchOnce("q", 10)).rejects.toThrow("socket closed");

        expect(client.destroyed).toBe(0);
        expect((SoulseekService as unknown as { client: unknown }).client).toBe(client);
    });

    test("reconnects once, and retries, when nothing is running on it", async () => {
        const dead = fakeClient(boom);
        const fresh = fakeClient(async () => found);
        const instance = service(dead, fresh);

        await expect(instance.searchOnce("q", 10)).resolves.toBe(found);

        expect(dead.destroyed).toBe(1);
        expect((SoulseekService as unknown as { client: unknown }).client).toBe(fresh);
    });

    test("a stop is not a dead connection", async () => {
        const abort = Object.assign(new Error("Aborted"), { name: "AbortError" });
        const client = fakeClient(() => Promise.reject(abort));
        const instance = service(client);

        await expect(instance.searchOnce("q", 10)).rejects.toBe(abort);
        expect(client.destroyed).toBe(0);
    });

    test("a stopped task stops waiting for the search", async () => {
        const client = fakeClient(() => new Promise<SearchResult[]>(() => {}));
        const instance = service(client);
        const controller = new AbortController();

        const waiting = instance.searchOnce("q", 60_000, controller.signal);
        controller.abort();

        await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        expect(client.destroyed).toBe(0);
    });

    test("a search already stopped is not started waiting", async () => {
        const client = fakeClient(async () => found);
        const instance = service(client);
        const controller = new AbortController();
        controller.abort();
        await expect(instance.searchOnce("q", 10, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    });
});
