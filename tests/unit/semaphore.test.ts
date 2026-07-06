import { describe, expect, test } from "vitest";
import { Semaphore } from "#utils/semaphore";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("Semaphore", () => {
    test("bounds concurrency to its limit and releases every permit", async () => {
        const sem = new Semaphore(2);
        let active = 0;
        let peak = 0;
        await Promise.all(
            Array.from({ length: 6 }, () =>
                sem.run(async () => {
                    active++;
                    peak = Math.max(peak, active);
                    await sleep(15);
                    active--;
                })
            )
        );
        expect(peak).toBe(2);
        expect(active).toBe(0);
    });

    test("releases the permit even when the work throws", async () => {
        const sem = new Semaphore(1);
        await expect(
            sem.run(async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");
        // If the failed run leaked its permit, this second run would deadlock.
        await expect(sem.run(async () => "ok")).resolves.toBe("ok");
    });

    test("setLimit grows the budget and wakes waiters", async () => {
        const sem = new Semaphore(1);
        sem.setLimit(3);
        let active = 0;
        let peak = 0;
        await Promise.all(
            Array.from({ length: 5 }, () =>
                sem.run(async () => {
                    active++;
                    peak = Math.max(peak, active);
                    await sleep(15);
                    active--;
                })
            )
        );
        expect(peak).toBe(3);
        expect(sem.getLimit()).toBe(3);
    });

    test("never drops below a limit of 1", () => {
        const sem = new Semaphore(0);
        expect(sem.getLimit()).toBe(1);
        sem.setLimit(-5);
        expect(sem.getLimit()).toBe(1);
    });
});
