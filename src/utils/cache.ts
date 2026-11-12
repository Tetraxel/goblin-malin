import { AsyncLocalStorage } from "async_hooks";
import { create } from "flat-cache";
import * as fs from "fs";
import { globalLogger } from "#base/logger/logger";
import { getCacheDir } from "./appPaths";

const skipCacheStorage = new AsyncLocalStorage<boolean>();

let cacheGloballyEnabled = true;
export function setCacheEnabled(v: boolean): void {
    cacheGloballyEnabled = v;
}

export function withSkipCache<T>(fn: () => Promise<T>): Promise<T> {
    return skipCacheStorage.run(true, fn);
}

// Global cache instance — path captured once at startup, consistent with clearCache
const CACHE_ID = "api-cache";
const cacheDir = getCacheDir();
export const cache = create({
    cacheId: CACHE_ID,
    cacheDir,

    // The time to live for the cache in milliseconds. 0 means no expiration
    ttl: 90 * 24 * 60 * 60 * 1000, // 90 days

    // The interval to save the data to disk. 0 means no persistence
    persistInterval: 2 * 60 * 1000, // 2 minutes

    // The interval to check for expired items in the cache. 0 means no expiration
    expirationInterval: 10 * 60 * 1000, // 10 minutes
});

export function clearCache(): void {
    cache.clear();
    try {
        fs.rmSync(cacheDir, { recursive: true, force: true });
    } catch {
        /* empty */
    }
    globalLogger.info("Cache cleared");
}

export function runWithoutCache<T>(fn: () => Promise<T>): Promise<T> {
    return withSkipCache(fn);
}

/** True inside `runWithoutCache`: the caller wants fresh answers, and in-memory caches must not answer for them either. */
export function isCacheSkipped(): boolean {
    return skipCacheStorage.getStore() === true;
}

/** How long a "nothing found" answer is kept: data may appear upstream tomorrow, errors can be transient. */
export const NEGATIVE_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CacheOptions {
    /** TTL in ms, or a function of the result (return `undefined` for the default). */
    ttl?: number | ((result: unknown) => number | undefined);
    /** Return `false` to keep a result out of the cache (e.g. a degraded fallback answer). */
    shouldCache?: (result: unknown) => boolean;
    keyGenerator?: (...args: unknown[]) => string;
}

// Calls currently running, per cache key: concurrent cold calls share one underlying request.
const inFlight = new Map<string, Promise<unknown>>();

/** Runs `compute` through the persistent cache. Exported for tests; use the `@Cached` decorator in services. */
export async function cachedCall<T>(
    cacheKey: string,
    compute: () => Promise<T>,
    options: CacheOptions = {}
): Promise<T> {
    // Return existing cache value ONLY if cache is globally enabled and not skipped for this call
    const shouldSkip = !cacheGloballyEnabled || skipCacheStorage.getStore() === true;
    if (!shouldSkip) {
        const cached = cache.get(cacheKey);
        if (cached !== undefined) {
            globalLogger.debug(`Cache found for ${cacheKey}`);
            return cached as T;
        }
        const pending = inFlight.get(cacheKey);
        if (pending) {
            globalLogger.debug(`Cache joined in-flight call for ${cacheKey}`);
            return pending as Promise<T>;
        }
        globalLogger.debug(`Cache miss for ${cacheKey}`);
    } else {
        globalLogger.debug(`Cache skip requested for ${cacheKey}`);
    }

    const run = (async () => {
        const result = await compute();

        const empty = result === undefined || result === null || result === "";
        if (empty) {
            globalLogger.warn(`Not caching a value "${result}" that may be an error case (${cacheKey})`);
        } else if (options.shouldCache && !options.shouldCache(result)) {
            globalLogger.debug(`Cache not saved for "${cacheKey}" (shouldCache refused it)`);
        } else {
            const ttl = typeof options.ttl === "function" ? options.ttl(result) : options.ttl;
            cache.set(cacheKey, result, ttl);
            globalLogger.debug(`Cache saved for "${cacheKey}"`);
        }
        return result;
    })();

    if (shouldSkip) return run;

    inFlight.set(cacheKey, run);
    try {
        return await run;
    } finally {
        inFlight.delete(cacheKey);
    }
}

// Method decorator to handle both @Cached and @Cached()
export function Cached(options: CacheOptions = {}) {
    return function (target: object, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
        const originalMethod = descriptor.value;
        const className = target.constructor.name;

        descriptor.value = function (this: unknown, ...args: unknown[]) {
            const cacheKey = `${className}:${propertyKey}:${JSON.stringify(args)}`;
            return cachedCall(cacheKey, () => originalMethod.apply(this, args), options);
        };

        return descriptor;
    };
}
