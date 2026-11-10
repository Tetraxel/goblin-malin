import { describe, test, expect } from "vitest";
import {
    isDueForLiveRefresh,
    liveRefreshWaitMs,
    MAX_LIVE_REFRESH_BACKOFF_MS,
} from "#flows/musicDownloadFlow/utils/liveRefreshDue";

const NOW = 1_000_000_000;
const INTERVAL = 120_000;

const playlist = (over: Record<string, unknown> = {}) => ({
    kind: "collection",
    collectionKind: "playlist",
    state: "finished",
    live: { enabled: true, lastFetchedAt: new Date(NOW - INTERVAL - 1) },
    ...over,
});

describe("isDueForLiveRefresh", () => {
    test("a playlist already fetched once is due after the interval", () => {
        expect(isDueForLiveRefresh(playlist(), NOW, INTERVAL)).toBe(true);
    });

    test("is not due before the interval has elapsed", () => {
        expect(
            isDueForLiveRefresh(
                playlist({ live: { enabled: true, lastFetchedAt: new Date(NOW - INTERVAL + 1000) } }),
                NOW,
                INTERVAL
            )
        ).toBe(false);
    });

    test("never starts a playlist the user has not run yet", () => {
        expect(isDueForLiveRefresh(playlist({ state: "pending", live: { enabled: true } }), NOW, INTERVAL)).toBe(false);
    });

    test("leaves a stopped, restarted (pending again), running or failed playlist alone", () => {
        for (const state of ["stopped", "pending", "running", "failed"]) {
            expect(isDueForLiveRefresh(playlist({ state }), NOW, INTERVAL)).toBe(false);
        }
    });

    test("needs a first successful fetch (lastFetchedAt)", () => {
        expect(isDueForLiveRefresh(playlist({ live: { enabled: true } }), NOW, INTERVAL)).toBe(false);
    });

    test("waits from the last failed attempt, not the last success", () => {
        const live = { enabled: true, lastFetchedAt: new Date(0), lastAttemptAt: new Date(NOW - 5_000), failures: 1 };
        expect(isDueForLiveRefresh(playlist({ live }), NOW, INTERVAL)).toBe(false);
    });

    test("backs off after consecutive failures", () => {
        const lastAttemptAt = new Date(NOW - INTERVAL - 1);
        const once = { enabled: true, lastFetchedAt: new Date(0), lastAttemptAt, failures: 1 };
        // one failure doubles the wait, so 120 s after the attempt is still too early
        expect(isDueForLiveRefresh(playlist({ live: once }), NOW, INTERVAL)).toBe(false);
        expect(isDueForLiveRefresh(playlist({ live: { ...once, failures: 0 } }), NOW, INTERVAL)).toBe(true);
        const later = { ...once, lastAttemptAt: new Date(NOW - 2 * INTERVAL - 1) };
        expect(isDueForLiveRefresh(playlist({ live: later }), NOW, INTERVAL)).toBe(true);
    });

    test("the wait doubles per failure and is capped at an hour", () => {
        expect(liveRefreshWaitMs(INTERVAL, undefined)).toBe(INTERVAL);
        expect(liveRefreshWaitMs(INTERVAL, 2)).toBe(4 * INTERVAL);
        expect(liveRefreshWaitMs(INTERVAL, 50)).toBe(MAX_LIVE_REFRESH_BACKOFF_MS);
        // a user interval above the cap is never shortened
        expect(liveRefreshWaitMs(2 * MAX_LIVE_REFRESH_BACKOFF_MS, 3)).toBe(2 * MAX_LIVE_REFRESH_BACKOFF_MS);
    });

    test("respects the live toggle and ignores albums and tracks", () => {
        expect(
            isDueForLiveRefresh(playlist({ live: { enabled: false, lastFetchedAt: new Date(0) } }), NOW, INTERVAL)
        ).toBe(false);
        expect(isDueForLiveRefresh(playlist({ collectionKind: "album" }), NOW, INTERVAL)).toBe(false);
        expect(isDueForLiveRefresh(playlist({ kind: "track" }), NOW, INTERVAL)).toBe(false);
        expect(isDueForLiveRefresh(undefined, NOW, INTERVAL)).toBe(false);
    });
});
