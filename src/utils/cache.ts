import { AsyncLocalStorage } from 'async_hooks';
import { create } from 'flat-cache';
import * as fs from 'fs';
import { globalLogger } from '../base/logger/logger';
import { getCacheDir } from './appPaths';

const skipCacheStorage = new AsyncLocalStorage<boolean>();

export function withSkipCache<T>(fn: () => Promise<T>): Promise<T> {
    return skipCacheStorage.run(true, fn);
}

// Global cache instance — path captured once at startup, consistent with clearCache
const CACHE_ID = 'api-cache'
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
    }
    catch {
        /* empty */
    }
    globalLogger.info('Cache cleared');
}

export function runWithoutCache<T>(fn: () => Promise<T>): Promise<T> {
    return withSkipCache(fn);
}

interface CacheOptions {
    ttl?: number;
    keyGenerator?: (...args: unknown[]) => string;
}

// Method decorator to handle both @Cached and @Cached()
export function Cached(options: CacheOptions = {}) {
    return function (
        target: object,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ): PropertyDescriptor {
        const originalMethod = descriptor.value;
        const className = target.constructor.name;

        descriptor.value = async function (...args: unknown[]) {
            // Generate cache key
            const cacheKey = `${className}:${propertyKey}:${JSON.stringify(args)}`;

            // Return existing cache value ONLY if skipCache is not set in the AsyncLocalStorage context
            const shouldSkip = skipCacheStorage.getStore() === true;
            if (!shouldSkip) {
                const cached = cache.get(cacheKey);
                if (cached !== undefined) {
                    globalLogger.debug(`Cache found for ${cacheKey}`);
                    return cached;
                }
                globalLogger.debug(`Cache miss for ${cacheKey}`);
            } else {
                globalLogger.debug(`Cache skip requested for ${cacheKey}`);
            }

            // Call original method and cache result
            const result = await originalMethod.apply(this, args);
            globalLogger.debug(`Cache saved for "${cacheKey}"`)
            cache.set(cacheKey, result, options.ttl);

            if (result === undefined || result === null || result === "")
                globalLogger.warn(`Cached a value "${result}" that may be an error case`)

            return result;
        };

        return descriptor;
    };
}
