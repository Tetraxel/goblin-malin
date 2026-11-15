export function makeAbortError(): Error {
    return Object.assign(new Error("Task stopped by user"), { name: "AbortError" });
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw makeAbortError();
}

/**
 * `promise`, but it rejects with an abort error as soon as `signal` aborts. The work behind the promise is not
 * cancelled (a promise cannot be): the caller just stops waiting for it, and its late result is ignored.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
        if (signal.aborted) return reject(makeAbortError());
        const onAbort = () => reject(makeAbortError());
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}
