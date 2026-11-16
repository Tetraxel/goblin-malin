import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// The cache lives under GOBLIN_DATA_DIR, resolved when #constants loads — point it at a temp dir
// before anything imports it (hence the dynamic import).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-cache-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

type CacheMod = typeof import("#utils/cache");
type DiscoveryCacheMod = typeof import("#flows/musicDownloadFlow/utils/discoveryCache");
let mod: CacheMod;
let discovery: DiscoveryCacheMod;

beforeAll(async () => {
    mod = await import("#utils/cache");
    discovery = await import("#flows/musicDownloadFlow/utils/discoveryCache");
});

afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("cachedCall", () => {
    test("a second call is served from the cache", async () => {
        let calls = 0;
        const compute = async () => ({ n: ++calls });
        const a = await mod.cachedCall("t:hit", compute);
        const b = await mod.cachedCall("t:hit", compute);
        expect(a).toEqual({ n: 1 });
        expect(b).toEqual({ n: 1 });
        expect(calls).toBe(1);
    });

    test("concurrent cold calls share one underlying call", async () => {
        let calls = 0;
        const compute = async () => {
            calls++;
            await tick();
            return "value";
        };
        const results = await Promise.all([
            mod.cachedCall("t:inflight", compute),
            mod.cachedCall("t:inflight", compute),
            mod.cachedCall("t:inflight", compute),
        ]);
        expect(results).toEqual(["value", "value", "value"]);
        expect(calls).toBe(1);
    });

    test("a failing call is not cached and not left in flight", async () => {
        let calls = 0;
        const compute = async () => {
            calls++;
            if (calls === 1) throw new Error("boom");
            return "ok";
        };
        await expect(mod.cachedCall("t:fail", compute)).rejects.toThrow("boom");
        await expect(mod.cachedCall("t:fail", compute)).resolves.toBe("ok");
        expect(calls).toBe(2);
    });

    test("shouldCache: false keeps a result out of the cache", async () => {
        let calls = 0;
        const compute = async () => ({ degraded: true, n: ++calls });
        const opts = { shouldCache: (r: unknown) => !(r as { degraded: boolean }).degraded };
        await mod.cachedCall("t:degraded", compute, opts);
        const second = await mod.cachedCall("t:degraded", compute, opts);
        expect(second.n).toBe(2);
    });

    test("null / empty results are not cached", async () => {
        let calls = 0;
        const compute = async () => {
            calls++;
            return null;
        };
        await mod.cachedCall("t:null", compute);
        await mod.cachedCall("t:null", compute);
        expect(calls).toBe(2);
    });

    test("a ttl function is applied to the result", async () => {
        let calls = 0;
        const compute = async () => ({ n: ++calls });
        await mod.cachedCall("t:ttl", compute, { ttl: () => 1 });
        await new Promise((r) => setTimeout(r, 30));
        const again = await mod.cachedCall("t:ttl", compute, { ttl: () => 1 });
        expect(again.n).toBe(2);
    });

    test("runWithoutCache bypasses the cache", async () => {
        let calls = 0;
        const compute = async () => ({ n: ++calls });
        await mod.cachedCall("t:skip", compute);
        const fresh = await mod.runWithoutCache(() => mod.cachedCall("t:skip", compute));
        expect(fresh.n).toBe(2);
    });
});

describe("discoveryResultTtl", () => {
    test("negative discovery results get the short TTL", () => {
        expect(discovery.discoveryResultTtl({ tracks: [] })).toBe(mod.NEGATIVE_RESULT_TTL_MS);
        expect(discovery.discoveryResultTtl({ tracks: [{}], anchor: { state: "notFound" } })).toBe(
            mod.NEGATIVE_RESULT_TTL_MS
        );
        expect(discovery.discoveryResultTtl(null)).toBe(mod.NEGATIVE_RESULT_TTL_MS);
    });

    test("found results use the default TTL", () => {
        expect(discovery.discoveryResultTtl({ tracks: [{}], anchor: { state: "found" } })).toBeUndefined();
    });
});

describe("what comes out of the cache", () => {
    test("a value that was read cannot be changed under the next reader", async () => {
        await mod.cachedCall("t:shared", async () => ({ nested: { n: 1 } }));
        const first = await mod.cachedCall("t:shared", async () => ({ nested: { n: 99 } }));
        first.nested.n = 2;
        expect((await mod.cachedCall("t:shared", async () => ({ nested: { n: 99 } }))).nested.n).toBe(1);
    });

    test("dates are dates, also when the file has them as text (after a restart)", () => {
        const loaded = {
            fetchedAt: "2026-11-16T10:20:30.000Z",
            title: "2026-11-16T10:20:30.000Z",
            tracks: [{ downloadedAt: "2026-01-02T03:04:05Z", name: "a" }],
            already: new Date(0),
        };
        const revived = mod.reviveCachedDates(loaded);
        expect(revived.fetchedAt).toBeInstanceOf(Date);
        expect((revived.fetchedAt as unknown as Date).getTime()).toBe(Date.parse("2026-11-16T10:20:30.000Z"));
        // Only the fields the app names `...At` are dates: a title that looks like one stays text.
        expect(revived.title).toBe("2026-11-16T10:20:30.000Z");
        expect(revived.tracks[0].downloadedAt).toBeInstanceOf(Date);
        expect(revived.already).toBeInstanceOf(Date);
    });

    test("a value that went through the file comes back with real dates", async () => {
        mod.cache.set("t:dates", { fetchedAt: "2026-11-16T10:20:30.000Z" });
        const hit = await mod.cachedCall("t:dates", async () => ({ fetchedAt: new Date() }));
        expect(hit.fetchedAt).toBeInstanceOf(Date);
    });
});

describe("saving the cache", () => {
    test("is written in the background, atomically, and only when something changed", async () => {
        mod.cache.set("t:persist", { n: 1 });
        expect(mod.cache.changesSinceLastSave).toBe(true);

        await mod.saveInBackground();

        expect(mod.cache.changesSinceLastSave).toBe(false);
        expect(fs.existsSync(mod.cache.cacheFilePath)).toBe(true);
        expect(fs.readdirSync(mod.cache.cacheDirPath).filter((n) => n.endsWith(".tmp"))).toEqual([]);

        const before = fs.statSync(mod.cache.cacheFilePath).mtimeMs;
        await new Promise((r) => setTimeout(r, 20));
        await mod.saveInBackground();
        expect(fs.statSync(mod.cache.cacheFilePath).mtimeMs).toBe(before);
    });

    test("what was saved is what a fresh start loads", async () => {
        mod.cache.set("t:reload", { fetchedAt: new Date("2026-05-05T05:05:05Z"), n: 7 });
        await mod.saveInBackground();

        const { create } = await import("flat-cache");
        const fresh = create({ cacheId: "api-cache", cacheDir: mod.cache.cacheDirPath });
        const loaded = fresh.get("t:reload") as { fetchedAt: unknown; n: number };
        expect(loaded.n).toBe(7);
        expect(mod.reviveCachedDates(loaded).fetchedAt).toBeInstanceOf(Date);
    });
});
