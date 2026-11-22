import { fetchWithTimeout } from "#utils/timeout";
import { sleep } from "#utils/sleep";
import { followLink } from "#utils/followLink";

const DEEZER_API = "https://api.deezer.com";

/** Deezer answered, but with an error (its API says 200 and puts the error in the body). */
export class DeezerApiError extends Error {
    constructor(
        message: string,
        readonly code: number | undefined
    ) {
        super(message);
        this.name = "DeezerApiError";
    }
}

/** Deezer's "no data" (an id that does not exist, or that is not available). */
export const DEEZER_NO_DATA = 800;
/** Deezer's "permission" errors: the item is there but not for this caller (a private playlist, an account-only one). */
export const DEEZER_PERMISSION_CODES: readonly number[] = [200, 300, 901];
/** Deezer's "quota exceeded": too many calls from this address in a short time. */
export const DEEZER_QUOTA = 4;

/**
 * Deezer allows 50 calls per 5 seconds from one address. Calls are spaced a little wider than that (one per 110 ms),
 * so a big album import slows down a little instead of being refused.
 */
const MIN_INTERVAL_MS = 110;
let nextSlot = 0;
/** Refused anyway (the window is per address, other programs count too): every call waits, then it is tried again. */
const QUOTA_RETRIES = 2;
const QUOTA_RETRY_MS = 5_000;

async function waitForSlot(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + MIN_INTERVAL_MS;
    if (at > now) await sleep(at - now);
}

/** Forgets the spacing between calls. For tests. */
export function resetDeezerPacing(): void {
    nextSlot = 0;
}

/**
 * One call to Deezer's public API (no key, no account): `path` is under `https://api.deezer.com`, `params` its query.
 * Throws a {@link DeezerApiError} when Deezer answers with an error, a plain `Error` when it does not answer.
 */
export async function deezerGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${DEEZER_API}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    for (let attempt = 0; ; attempt++) {
        await waitForSlot();
        const response = await fetchWithTimeout()(url, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Deezer answered ${response.status} for ${path}`);
        const body = (await response.json()) as T & { error?: { message?: string; type?: string; code?: number } };
        if (body && typeof body === "object" && body.error) {
            const { message, type, code } = body.error;
            if (code === DEEZER_QUOTA && attempt < QUOTA_RETRIES) {
                // The refusal is about the address: every caller waits, not only this one.
                nextSlot = Math.max(nextSlot, Date.now() + QUOTA_RETRY_MS);
                continue;
            }
            const text = code === DEEZER_QUOTA ? "too many requests in a short time, try again in a minute" : "";
            throw new DeezerApiError(`Deezer: ${text || message || type || "error"} (${path})`, code);
        }
        return body;
    }
}

/** Where a short link (`link.deezer.com/s/…`) leads: the address of the last page it redirects to. */
export const followShortLink = followLink;
