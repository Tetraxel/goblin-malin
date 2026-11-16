/**
 * Time limits for calls to the outside world. A connection that stalls would otherwise hold one of the few metadata
 * slots until the runtime gives up on its own (minutes), and with a few of them stalled the whole stage stops.
 */

/** How long one request to a provider may take before the track's step fails (a request normally takes a second). */
export const PROVIDER_TIMEOUT_MS = 30_000;

export class TimeoutError extends Error {
    constructor(what: string, ms: number) {
        super(`${what} did not answer within ${Math.round(ms / 1000)}s`);
        this.name = "TimeoutError";
    }
}

/**
 * `promise`, or a {@link TimeoutError} when it has not settled after `ms`. The work behind the promise is not stopped
 * (a promise cannot be cancelled): the caller stops waiting for it, which is what frees the slot it holds.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
        timer.unref();
    });
    // The abandoned promise may still fail later: that is not an unhandled rejection.
    promise.catch(() => undefined);
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** A `fetch` that gives up after `ms` (and also when the caller's own signal aborts). */
export function fetchWithTimeout(ms: number = PROVIDER_TIMEOUT_MS): typeof globalThis.fetch {
    return (input, init) => {
        const limit = AbortSignal.timeout(ms);
        const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
        return globalThis.fetch(input, { ...init, signal });
    };
}

/**
 * `api` with every method that returns a promise limited to `ms`. For clients that offer no timeout of their own:
 * the object is used as before, and a call that stalls fails with a {@link TimeoutError}.
 */
export function withTimeouts<T extends object>(api: T, ms: number, what: string): T {
    return new Proxy(api, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
                const result = (value as (...a: unknown[]) => unknown).apply(target, args);
                return result instanceof Promise ? withTimeout(result, ms, `${what}.${String(property)}`) : result;
            };
        },
    });
}
