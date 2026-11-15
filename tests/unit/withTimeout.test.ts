import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withTimeout } from "#utils/withTimeout";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
    test("gives the value of a promise that is in time, and passes its error on", async () => {
        await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
        await expect(withTimeout(Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
    });

    test("rejects with the message when the promise is too slow, and ignores its late answer", async () => {
        const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 5000));
        const guarded = withTimeout(slow, 1000, "too slow");
        const outcome = expect(guarded).rejects.toThrow("too slow");
        await vi.advanceTimersByTimeAsync(1001);
        await outcome;
        await vi.advanceTimersByTimeAsync(5000);
    });
});
