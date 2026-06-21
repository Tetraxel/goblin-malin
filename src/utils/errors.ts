export function makeAbortError(): Error {
    return Object.assign(new Error("Task stopped by user"), { name: "AbortError" });
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw makeAbortError();
}
