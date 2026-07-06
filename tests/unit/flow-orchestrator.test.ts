import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { FlowOrchestrator } from "#base/flow/flow-orchestrator";
import { Task } from "#base/task/task";
import { globalLogger } from "#base/logger/logger";
import { notificationScheduler } from "#base/notificationScheduler";

// Deterministic + no lingering frame timers between assertions.
notificationScheduler.setSyncMode(true);
afterAll(() => notificationScheduler.setSyncMode(false));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Shared {
    active: number;
    peak: number;
    started: number;
}

class FakeTask extends Task<{ state?: string }> {
    constructor(
        id: string,
        private ms: number,
        private shared: Shared
    ) {
        super({ id, flowId: "test-flow", logger: globalLogger });
    }

    override async start(signal?: AbortSignal): Promise<void> {
        this.shared.started++;
        this.shared.active++;
        this.shared.peak = Math.max(this.shared.peak, this.shared.active);
        try {
            await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, this.ms);
                signal?.addEventListener(
                    "abort",
                    () => {
                        clearTimeout(t);
                        const err = new Error("aborted");
                        err.name = "AbortError";
                        reject(err);
                    },
                    { once: true }
                );
            });
        } finally {
            this.shared.active--;
        }
    }
}

const orchestrator = FlowOrchestrator.getInstance();

beforeEach(() => {
    orchestrator.setTasks([]);
});

describe("FlowOrchestrator — event-driven pump", () => {
    test("runs tasks in parallel up to the cap and completes them all", async () => {
        orchestrator.setGlobalMaxConcurrent(2);
        const shared: Shared = { active: 0, peak: 0, started: 0 };
        orchestrator.setTasks(Array.from({ length: 5 }, (_, i) => new FakeTask(`t${i}`, 30, shared)));

        const t0 = Date.now();
        await orchestrator.processTasks();
        const elapsed = Date.now() - t0;

        expect(shared.peak).toBe(2); // never exceeded the concurrency cap
        expect(shared.started).toBe(5); // every task ran
        expect(orchestrator.getTasks().every((t) => t.finishedAt !== undefined)).toBe(true);
        expect(orchestrator.isProcessing()).toBe(false);
        // 5 tasks at cap 2 = 3 waves ≈ 90ms; a serial loop would be ~150ms.
        expect(elapsed).toBeLessThan(140);
    });

    test("abort stops new launches, drains in-flight work, and settles", async () => {
        orchestrator.setGlobalMaxConcurrent(2);
        const shared: Shared = { active: 0, peak: 0, started: 0 };
        orchestrator.setTasks(Array.from({ length: 6 }, (_, i) => new FakeTask(`a${i}`, 80, shared)));

        const done = orchestrator.processTasks();
        await sleep(20); // let the first wave start
        orchestrator.stopProcessing();
        await done;

        expect(shared.started).toBeLessThan(6); // did not launch the whole queue
        expect(shared.active).toBe(0); // no leaked in-flight work
        expect(orchestrator.isProcessing()).toBe(false); // settled
    });

    test("resolves immediately when there are no candidates", async () => {
        orchestrator.setGlobalMaxConcurrent(3);
        await expect(orchestrator.processTasks()).resolves.toBeUndefined();
        expect(orchestrator.isProcessing()).toBe(false);
    });

    test("addTasks rejects a duplicate id (O(1) identity check)", () => {
        const shared: Shared = { active: 0, peak: 0, started: 0 };
        orchestrator.setTasks([new FakeTask("dup", 1, shared)]);
        expect(() => orchestrator.addTasks([new FakeTask("dup", 1, shared)])).toThrow(/already in the queue/);
    });

    test("a second processTasks call while processing is ignored", async () => {
        orchestrator.setGlobalMaxConcurrent(1);
        const shared: Shared = { active: 0, peak: 0, started: 0 };
        orchestrator.setTasks([new FakeTask("s0", 60, shared), new FakeTask("s1", 60, shared)]);

        const first = orchestrator.processTasks();
        await sleep(10);
        await orchestrator.processTasks(); // should no-op (already processing)
        await first;

        expect(shared.started).toBe(2);
        expect(shared.peak).toBe(1);
    });
});
