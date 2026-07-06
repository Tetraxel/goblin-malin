import { afterEach, describe, expect, test } from "vitest";
import { notificationScheduler } from "#base/notificationScheduler";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => notificationScheduler.setSyncMode(false));

describe("notificationScheduler", () => {
    test("coalesces many schedules of the same fn into one call per frame", async () => {
        let calls = 0;
        const fn = () => {
            calls++;
        };
        for (let i = 0; i < 100; i++) notificationScheduler.schedule(fn);
        expect(calls).toBe(0); // deferred, not synchronous
        await sleep(40);
        expect(calls).toBe(1); // 100 dirty marks → a single flush call
    });

    test("fires each distinct fn once per frame", async () => {
        let a = 0;
        let b = 0;
        notificationScheduler.schedule(() => a++);
        notificationScheduler.schedule(() => b++);
        notificationScheduler.schedule(() => a++); // same identity as first? no — new closure
        await sleep(40);
        // Two of the three closures are distinct references; the third is also distinct,
        // so all three run once → a=2, b=1.
        expect(a).toBe(2);
        expect(b).toBe(1);
    });

    test("a notification scheduled during flush lands in the next frame, not this one", async () => {
        const order: string[] = [];
        const second = () => order.push("second");
        const first = () => {
            order.push("first");
            notificationScheduler.schedule(second); // must not run inside this flush
        };
        notificationScheduler.schedule(first);
        await sleep(40);
        expect(order).toEqual(["first", "second"]);
    });

    test("flushNow runs pending notifications synchronously", () => {
        let calls = 0;
        notificationScheduler.schedule(() => calls++);
        expect(calls).toBe(0);
        notificationScheduler.flushNow();
        expect(calls).toBe(1);
    });

    test("sync mode runs notifications inline", () => {
        notificationScheduler.setSyncMode(true);
        let calls = 0;
        notificationScheduler.schedule(() => calls++);
        expect(calls).toBe(1);
    });

    test("a throwing subscriber does not stall the rest of the batch", async () => {
        let good = 0;
        notificationScheduler.schedule(() => {
            throw new Error("bad subscriber");
        });
        notificationScheduler.schedule(() => good++);
        await sleep(40);
        expect(good).toBe(1);
    });
});
