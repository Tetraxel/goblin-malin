import { fetchWithTimeout } from "#utils/timeout";

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

/**
 * One call to Deezer's public API (no key, no account): `path` is under `https://api.deezer.com`, `params` its query.
 * Throws a {@link DeezerApiError} when Deezer answers with an error, a plain `Error` when it does not answer.
 */
export async function deezerGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${DEEZER_API}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetchWithTimeout()(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Deezer answered ${response.status} for ${path}`);
    const body = (await response.json()) as T & { error?: { message?: string; type?: string; code?: number } };
    if (body && typeof body === "object" && body.error) {
        const { message, type, code } = body.error;
        throw new DeezerApiError(`Deezer: ${message || type || "error"} (${path})`, code);
    }
    return body;
}

/** Where a short link (`link.deezer.com/s/…`) leads: the address of the last page it redirects to. */
export async function followShortLink(url: string): Promise<string> {
    const response = await fetchWithTimeout()(url, { redirect: "follow" });
    // Only the address is wanted, not the page.
    await response.body?.cancel().catch(() => undefined);
    return response.url || url;
}
