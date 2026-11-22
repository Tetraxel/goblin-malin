import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { itunesGet, resetITunesPacing } from "#flows/musicDownloadFlow/services/apis/itunes-client";
import { metadataLimiter } from "#flows/musicDownloadFlow/utils/stageLimiters";

const fetchMock = vi.fn();

describe("itunesGet pacing", () => {
    let limit: number;
    beforeEach(() => {
        vi.useFakeTimers();
        resetITunesPacing();
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        limit = metadataLimiter.getLimit();
        metadataLimiter.setLimit(1);
    });
    afterEach(() => {
        metadataLimiter.setLimit(limit);
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    test("calls are spaced, and the wait is told to the caller", async () => {
        const waits: number[] = [];
        await itunesGet("search", { term: "a" });
        const second = itunesGet("search", { term: "b" }, { onWait: (ms) => waits.push(ms) });
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(waits).toEqual([3000]);
        await vi.advanceTimersByTimeAsync(3000);
        await second;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("a call waiting for Apple's turn gives its metadata slot to other work meanwhile", async () => {
        await metadataLimiter.run(() => itunesGet("search", { term: "a" }));
        // This one holds the only slot and must wait 3 s for Apple.
        const apple = metadataLimiter.run(() => itunesGet("search", { term: "b" }));
        const other = vi.fn(async () => "done");
        const otherWork = metadataLimiter.run(other);

        await vi.advanceTimersByTimeAsync(100);
        // The other task did not wait for the Apple turn.
        expect(other).toHaveBeenCalled();
        await expect(otherWork).resolves.toBe("done");
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(3000);
        await apple;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("a call whose caller gives up leaves the queue without using a turn (APPLE-01)", async () => {
        await itunesGet("search", { term: "a" });
        const skipped = new AbortController();
        const gone = itunesGet("search", { term: "skipped" }, { signal: skipped.signal }).catch((e: Error) => e);
        const next = itunesGet("search", { term: "next" });
        await vi.advanceTimersByTimeAsync(0);
        skipped.abort();
        expect(await gone).toMatchObject({ name: "AbortError" });

        // The next call takes the first turn (3 s), not the one after the skipped call (6 s).
        await vi.advanceTimersByTimeAsync(3000);
        await next;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[1][0])).toContain("term=next");
    });

    test("a refusal makes every caller wait, not only the one refused (APPLE-01)", async () => {
        fetchMock.mockImplementationOnce(async () => new Response("", { status: 403 }));
        const refused = itunesGet("search", { term: "a" });
        await vi.advanceTimersByTimeAsync(0);
        const other = itunesGet("search", { term: "b" });

        // Without the shared back-off, "b" would go 3 s after "a".
        await vi.advanceTimersByTimeAsync(9000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5000);
        await Promise.all([refused, other]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
