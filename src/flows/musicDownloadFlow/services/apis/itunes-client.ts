import { fetchWithTimeout } from "#utils/timeout";
import { makeAbortError, throwIfAborted } from "#utils/errors";
import { metadataLimiter } from "#flows/musicDownloadFlow/utils/stageLimiters";

const ITUNES_API = "https://itunes.apple.com";

/**
 * Apple asks for "about 20 calls per minute" to its Search API and answers 403 past it: calls are spaced so a big
 * import slows down instead of failing.
 */
const MIN_INTERVAL_MS = 3_000;
/** When the next call of the app may go to Apple (epoch ms). */
let nextSlot = 0;
/** Refused anyway (other programs on the same address count too): tried once more, a little later. */
const REFUSED_RETRIES = 1;
/** How long every caller waits after Apple refused one: the refusal is about the address, not about one call. */
const REFUSED_RETRY_MS = 10_000;

export type ITunesCallOptions = {
    /** Called when the call has to wait for its turn, with how long (ms): the caller can show it. */
    onWait?: (waitMs: number) => void;
    /**
     * Aborts when nobody waits for the answer any more (a skipped search, a stopped track): the call leaves the queue
     * without using a turn, and one already sent is cancelled.
     */
    signal?: AbortSignal;
};

/** The calls waiting for their turn, first come first served. A call that gives up leaves its place to the next. */
type Waiter = { go: () => void };
const queue: Waiter[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** Lets the next waiting call go when its turn has come, and sets a timer for the one after. */
function pump(): void {
    if (timer) return;
    while (queue.length > 0) {
        const now = Date.now();
        if (now < nextSlot) {
            timer = setTimeout(() => {
                timer = undefined;
                pump();
            }, nextSlot - now);
            return;
        }
        nextSlot = now + MIN_INTERVAL_MS;
        queue.shift()!.go();
    }
}

/**
 * Waits for this call's turn. Waiting is not work: a caller that holds a metadata slot (a track's discovery) gives it
 * back while it waits, so the other tasks' Spotify, YouTube or Deezer calls go on meanwhile. It takes one again
 * before calling Apple.
 */
async function waitForSlot(options: ITunesCallOptions): Promise<void> {
    const { signal } = options;
    throwIfAborted(signal);
    const now = Date.now();
    if (queue.length === 0 && now >= nextSlot) {
        nextSlot = now + MIN_INTERVAL_MS;
        return;
    }
    options.onWait?.(Math.max(0, nextSlot - now) + queue.length * MIN_INTERVAL_MS);
    await metadataLimiter.whileWaiting(
        () =>
            new Promise<void>((resolve, reject) => {
                const waiter: Waiter = {
                    go: () => {
                        signal?.removeEventListener("abort", onAbort);
                        resolve();
                    },
                };
                const onAbort = () => {
                    const index = queue.indexOf(waiter);
                    if (index !== -1) queue.splice(index, 1);
                    reject(makeAbortError());
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                queue.push(waiter);
                pump();
            })
    );
}

/** Forgets the spacing between calls and the calls waiting. For tests. */
export function resetITunesPacing(): void {
    nextSlot = 0;
    queue.length = 0;
    if (timer) clearTimeout(timer);
    timer = undefined;
}

/**
 * One call to Apple's public iTunes Search / Lookup API (no key, no account): `endpoint` is `search` or `lookup`.
 * Throws a readable `Error` when Apple refuses (too many calls) or does not answer, and an abort error when
 * `options.signal` aborts.
 */
export async function itunesGet<T>(
    endpoint: "search" | "lookup",
    params: Record<string, string | number>,
    options: ITunesCallOptions = {}
): Promise<T> {
    const url = new URL(`${ITUNES_API}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let response: Response | undefined;
    for (let attempt = 0; attempt <= REFUSED_RETRIES; attempt++) {
        await waitForSlot(options);
        response = await fetchWithTimeout()(url, {
            headers: { Accept: "application/json" },
            ...(options.signal ? { signal: options.signal } : {}),
        });
        if (response.status !== 403 && response.status !== 429) break;
        await response.body?.cancel().catch(() => undefined);
        // Apple refuses this address for a while: every call waits, not only this one.
        nextSlot = Math.max(nextSlot, Date.now() + REFUSED_RETRY_MS);
    }
    if (!response || response.status === 403 || response.status === 429) {
        throw new Error("Apple Music refused: too many requests in a short time, try again in a minute");
    }
    if (!response.ok) throw new Error(`Apple Music answered ${response.status} for ${endpoint}`);
    return (await response.json()) as T;
}
