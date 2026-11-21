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
});
