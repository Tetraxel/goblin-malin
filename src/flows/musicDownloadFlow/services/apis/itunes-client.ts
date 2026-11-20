import { fetchWithTimeout } from "#utils/timeout";
import { sleep } from "#utils/sleep";

const ITUNES_API = "https://itunes.apple.com";

/**
 * Apple asks for "about 20 calls per minute" to its Search API and answers 403 past it: calls are spaced so a big
 * import slows down instead of failing.
 */
const MIN_INTERVAL_MS = 3_000;
let nextSlot = 0;
/** Refused anyway (other programs on the same address count too): tried once more, a little later. */
const REFUSED_RETRIES = 1;
const REFUSED_RETRY_MS = 10_000;

async function waitForSlot(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + MIN_INTERVAL_MS;
    if (at > now) await sleep(at - now);
}

/** Forgets the spacing between calls. For tests. */
export function resetITunesPacing(): void {
    nextSlot = 0;
}

/**
 * One call to Apple's public iTunes Search / Lookup API (no key, no account): `endpoint` is `search` or `lookup`.
 * Throws a readable `Error` when Apple refuses (too many calls) or does not answer.
 */
export async function itunesGet<T>(endpoint: "search" | "lookup", params: Record<string, string | number>): Promise<T> {
    const url = new URL(`${ITUNES_API}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let response: Response | undefined;
    for (let attempt = 0; attempt <= REFUSED_RETRIES; attempt++) {
        if (attempt > 0) await sleep(REFUSED_RETRY_MS);
        await waitForSlot();
        response = await fetchWithTimeout()(url, { headers: { Accept: "application/json" } });
        if (response.status !== 403 && response.status !== 429) break;
        await response.body?.cancel().catch(() => undefined);
    }
    if (!response || response.status === 403 || response.status === 429) {
        throw new Error("Apple Music refused: too many requests in a short time, try again in a minute");
    }
    if (!response.ok) throw new Error(`Apple Music answered ${response.status} for ${endpoint}`);
    return (await response.json()) as T;
}
