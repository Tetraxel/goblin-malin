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
