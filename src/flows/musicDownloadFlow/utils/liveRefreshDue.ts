// `import type` (not an inline `type`): types.ts pulls in the whole flow, which this pure module must not load.
import type { CollectionLiveRefresh } from "../types";

// A failing playlist waits twice as long after each consecutive failure, up to this much.
export const MAX_LIVE_REFRESH_BACKOFF_MS = 60 * 60 * 1000;

export type LiveRefreshCandidate = {
    kind?: string;
    collectionKind?: string;
    state?: string;
    live?: CollectionLiveRefresh;
};

/** How long to wait after the last attempt: the user's interval, doubled per consecutive failure, capped at 1 h. */
export function liveRefreshWaitMs(intervalMs: number, failures: number | undefined): number {
    const doubled = intervalMs * 2 ** Math.min(failures ?? 0, 20);
    return Math.min(doubled, Math.max(intervalMs, MAX_LIVE_REFRESH_BACKOFF_MS));
}

/**
 * Whether a collection's live refresh is due. Live refresh only keeps a playlist up to date: it
 * never starts one. A playlist that has not been fetched by the user's own Run yet (`pending`,
 * `running`), one the user stopped, one whose first fetch failed (no `lastFetchedAt`), and one that
 * was restarted (`pending` again) are all left alone until a Run makes them `finished`.
 * The wait counts from the last attempt (failed or not), so a failing playlist is not hammered.
 */
export function isDueForLiveRefresh(attrs: LiveRefreshCandidate | undefined, now: number, intervalMs: number): boolean {
    if (attrs?.kind !== "collection" || attrs.collectionKind !== "playlist" || !attrs.live?.enabled) return false;
    if (attrs.state !== "finished") return false;
    const { lastFetchedAt, lastAttemptAt, failures } = attrs.live;
    if (!lastFetchedAt) return false;
    const lastAttempt = Math.max(lastFetchedAt.getTime(), lastAttemptAt?.getTime() ?? 0);
    return now - lastAttempt >= liveRefreshWaitMs(intervalMs, failures);
}
