import { fetchWithTimeout } from "#utils/timeout";

/**
 * Where a short link (`link.deezer.com/s/…`, `on.soundcloud.com/…`) leads: the address of the last page it redirects
 * to. Only the address is read, never the page. Throws when the link cannot be reached (offline, a time-out).
 */
export async function followLink(url: string): Promise<string> {
    const response = await fetchWithTimeout()(url, { redirect: "follow" });
    await response.body?.cancel().catch(() => undefined);
    return response.url || url;
}
