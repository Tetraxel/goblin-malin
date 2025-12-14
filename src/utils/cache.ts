import { create } from 'flat-cache';
import { globalLogger } from '../base/logger/logger';
import { CACHE_DIR } from '../constants';

// Global cache instance
const CACHE_ID = 'api-cache'
export const cache = create({
    cacheId: CACHE_ID,
    cacheDir: CACHE_DIR,

    // The time to live for the cache in milliseconds. 0 means no expiration
    ttl: 100 * 24 * 60 * 60 * 1000, // 100 days

    // The interval to save the data to disk. 0 means no persistence
    persistInterval: 2 * 60 * 1000, // 2 minutes

    // The interval to check for expired items in the cache. 0 means no expiration
    expirationInterval: 5 * 60 * 1000, // 5 minutes
});

interface CacheOptions {
    ttl?: number;
    keyGenerator?: (...args: any[]) => string;
}

// Method decorator to handle both @Cached and @Cached()
export function Cached(options: CacheOptions = {}) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ): PropertyDescriptor {
        const originalMethod = descriptor.value;
        const className = target.constructor.name;

        descriptor.value = async function (...args: any[]) {
            // Generate cache key
            const cacheKey = `${className}:${propertyKey}:${JSON.stringify(args)}`;

            // Check cache
            const cached = cache.get(cacheKey);
            if (cached !== undefined) {
                globalLogger.debug(`Cache found for ${cacheKey}`);
                return cached;
            }

            // Call original method
            globalLogger.debug(`Cache miss for ${cacheKey}`);
            const result = await originalMethod.apply(this, args);

            // Store in cache
            cache.set(cacheKey, result, options.ttl);

            return result;
        };

        return descriptor;
    };
}
