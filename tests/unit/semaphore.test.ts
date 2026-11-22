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

/** Runs a few jobs at once and reports the most that ran together: a leaked or doubled permit shows here. */
async function peakConcurrency(sem: Semaphore, jobs = 4): Promise<number> {
    let active = 0;
    let peak = 0;
    await Promise.all(
        Array.from({ length: jobs }, () =>
            sem.run(async () => {
                peak = Math.max(peak, ++active);
                await sleep(5);
                active--;
            })
        )
    );
    return peak;
}

describe("Semaphore.whileWaiting", () => {
    test("gives the permit back while the holder waits, and takes one again after", async () => {
        const sem = new Semaphore(1);
        let finishWait!: () => void;
        const waiting = new Promise<void>((resolve) => (finishWait = resolve));
        const events: string[] = [];

        const holder = sem.run(async () => {
            events.push("holder in");
            await sem.whileWaiting(() => waiting);
            events.push("holder back");
        });
        await sleep(5);
        // The only permit is out with a holder that waits for a person: another task still gets to work.
        await sem.run(async () => void events.push("other ran"));
        finishWait();
        await holder;

        expect(events).toEqual(["holder in", "other ran", "holder back"]);
        expect(await peakConcurrency(sem)).toBe(1);
    });

    test("the permit is taken back even when the wait fails", async () => {
        const sem = new Semaphore(1);
        await sem.run(async () => {
            await expect(
                sem.whileWaiting(async () => {
                    throw new Error("boom");
                })
            ).rejects.toThrow("boom");
        });
        expect(await peakConcurrency(sem)).toBe(1);
    });

    test("a caller that holds no permit just runs the function", async () => {
        const sem = new Semaphore(1);
        await expect(sem.whileWaiting(async () => "done")).resolves.toBe("done");
        expect(await peakConcurrency(sem)).toBe(1);
    });

    test("parallel branches of one run waiting together give the one permit back once", async () => {
        const sem = new Semaphore(1);
        await sem.run(async () => {
            await Promise.all([
                sem.whileWaiting(() => sleep(5)),
                sem.whileWaiting(() => sleep(15)),
                sem.whileWaiting(() => sleep(1)),
            ]);
        });
        // A permit lost or made up by the overlap would show as a different peak.
        expect(await peakConcurrency(sem)).toBe(1);
    });

    test("a branch still waiting when its run ends never puts the stage over its cap (SEM-01)", async () => {
        const sem = new Semaphore(1);
        let finishWait!: () => void;
        const waiting = new Promise<void>((resolve) => (finishWait = resolve));
        let branch!: Promise<void>;
        // The run returns without waiting for its branch (a skipped platform search, still in Apple's queue).
        await sem.run(async () => {
            branch = sem.whileWaiting(() => waiting);
        });

        // While the branch still waits, the stage is at most at its cap...
        let active = 0;
        let peak = 0;
        const jobs = Array.from({ length: 3 }, () =>
            sem.run(async () => {
                peak = Math.max(peak, ++active);
                await sleep(5);
                active--;
            })
        );
        await sleep(2);
        finishWait();
        await Promise.all([branch, ...jobs]);
        expect(peak).toBe(1);
        // ...and once it is over, no permit is lost or made up.
        expect(await peakConcurrency(sem)).toBe(1);
        await expect(Promise.race([sem.run(async () => "free"), sleep(50).then(() => "stuck")])).resolves.toBe("free");
    });

    test("waiting inside a wait does not give a permit back twice", async () => {
        const sem = new Semaphore(1);
        await sem.run(() => sem.whileWaiting(() => sem.whileWaiting(async () => sleep(5))));
        expect(await peakConcurrency(sem)).toBe(1);
    });
});
