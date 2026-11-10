import { describe, expect, test, vi } from "vitest";
import { createSingleFlight } from "#flows/musicDownloadFlow/utils/singleFlight";

describe("createSingleFlight", () => {
    test("a call made while a job runs is ignored, even in the same tick", async () => {
        const flight = createSingleFlight();
        let release!: () => void;
        const job = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));

        const first = flight.run(job);
        const second = flight.run(job); // a held-down key repeating before anything awaited
        expect(flight.busy).toBe(true);
        expect(await second).toBe(false);

        release();
        expect(await first).toBe(true);
        expect(job).toHaveBeenCalledTimes(1);
        expect(flight.busy).toBe(false);
    });

    test("another job can start once the first one finished", async () => {
        const flight = createSingleFlight();
        const job = vi.fn(async () => {});
        expect(await flight.run(job)).toBe(true);
        expect(await flight.run(job)).toBe(true);
        expect(job).toHaveBeenCalledTimes(2);
    });

    test("a failing job rejects and still releases the guard", async () => {
        const flight = createSingleFlight();
        await expect(
            flight.run(async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");
        expect(flight.busy).toBe(false);
        expect(await flight.run(async () => {})).toBe(true);
    });
});
