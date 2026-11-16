import { AsyncLocalStorage } from "async_hooks";
import { create } from "flat-cache";
import * as fs from "fs";
import { globalLogger } from "#base/logger/logger";
import { getCacheDir } from "./appPaths";
import { renameReplacing } from "./dataFile";

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
/** The most entries kept: the least recently used go first. Albums and playlists are stored whole, so it is bounded. */
const MAX_ENTRIES = 3000;
/** How often changes are written to disk (in the background, see {@link saveInBackground}). */
const SAVE_EVERY_MS = 2 * 60 * 1000;

export const cache = create({
    cacheId: CACHE_ID,
    cacheDir,

    // The time to live for the cache in milliseconds. 0 means no expiration
    ttl: 90 * 24 * 60 * 60 * 1000, // 90 days

    // Not the library's own timer: it writes the whole file synchronously, on the thread that draws the screen.
    persistInterval: 0,
    lruSize: MAX_ENTRIES,

    // The interval to check for expired items in the cache. 0 means no expiration
    expirationInterval: 10 * 60 * 1000, // 10 minutes
});

// What flat-cache keeps to itself: how it writes its file, and whether anything changed since it last did.
type FlatCacheInternals = { _stringify?: (items: unknown) => string; _changesSinceLastSave?: boolean };

let saving = false;

/**
 * Writes the cache file without blocking the screen on the disk: the text is built, then written to a temporary file
 * and renamed, off the main path (the library's own `save()` writes synchronously). Falls back to `save()` when the
 * library no longer has the parts this relies on. A failure keeps the changes flagged, so the next round tries again.
 */
export async function saveInBackground(): Promise<void> {
    if (saving || !cache.changesSinceLastSave) return;
    const internals = cache as unknown as FlatCacheInternals;
    if (!internals._stringify) {
        cache.save();
        return;
    }
    saving = true;
    try {
        const data = internals._stringify([...cache.items]);
        // Anything changed from here on is flagged again and goes in the next round.
        internals._changesSinceLastSave = false;
        const file = cache.cacheFilePath;
        const staging = `${file}.${process.pid}.tmp`;
        try {
            await fs.promises.mkdir(cache.cacheDirPath, { recursive: true });
            await fs.promises.writeFile(staging, data);
            await renameReplacing(staging, file);
        } catch (error) {
            internals._changesSinceLastSave = true;
            await fs.promises.rm(staging, { force: true }).catch(() => undefined);
            throw error;
        }
    } catch (error) {
        globalLogger.warn("The cache could not be saved", { error });
    } finally {
        saving = false;
    }
}

setInterval(() => void saveInBackground(), SAVE_EVERY_MS).unref();

/**
 * Dates come back from the cache file as text (JSON has no dates), but only after a restart: in the same session they
 * are dates. Every field the app names `...At` that holds an ISO date text is turned back into a date, in one place,
 * so no reader has to know which of the two it got.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export function reviveCachedDates<T>(value: T): T {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = reviveCachedDates(value[i]);
        return value;
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record)) {
            const field = record[key];
            if (typeof field === "string" && key.endsWith("At") && ISO_DATE.test(field)) {
                record[key] = new Date(field);
            } else if (field && typeof field === "object") {
                reviveCachedDates(field);
            }
        }
    }
    return value;
}

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
            return reviveCachedDates(cached) as T;
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
