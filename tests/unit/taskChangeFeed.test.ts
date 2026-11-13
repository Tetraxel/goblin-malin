import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Task } from "#base/task/task";
import { globalLogger } from "#base/logger/logger";
import { notificationScheduler } from "#base/notificationScheduler";
import { StatusType } from "#base/task/task-status";
import { pendingPrompts } from "#base/task/pending-prompts";

const makeTasks = (count: number): Task[] =>
    Array.from({ length: count }, (_, i) => new Task({ id: `t${i}`, attributes: {}, logger: globalLogger }));

beforeEach(() => {
    // Real batching, as in production: a frame's changes are delivered together.
    notificationScheduler.setSyncMode(false);
    vi.useFakeTimers();
});
afterEach(() => {
    // Drain what this test left scheduled while the fake timers still exist: a timer dropped by `useRealTimers`
    // would leave the scheduler believing a flush is pending, and swallow every later notification.
    vi.runAllTimers();
    notificationScheduler.flushNow();
    vi.runAllTimers();
    vi.useRealTimers();
});

describe("Task.subscribeToAny", () => {
    test("tells once per frame however many tasks changed, and does not replay the current state", () => {
        const tasks = makeTasks(2000);
        const listener = vi.fn();
        const off = Task.subscribeToAny(listener);
        expect(listener).not.toHaveBeenCalled();

        for (const task of tasks) task.getStatus().update({ type: StatusType.Processing, message: "working" });
        tasks[0]!.updateAttributes({ x: 1 });
        vi.advanceTimersByTime(20);
        expect(listener).toHaveBeenCalledTimes(1);

        tasks[5]!.updateAttributes({ x: 2 });
        vi.advanceTimersByTime(20);
        expect(listener).toHaveBeenCalledTimes(2);

        off();
        tasks[5]!.updateAttributes({ x: 3 });
        vi.advanceTimersByTime(20);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    test("a prompt appearing counts as a change", () => {
        const [task] = makeTasks(1);
        const listener = vi.fn();
        const off = Task.subscribeToAny(listener);
        const answer = task!.getPrompt().askInput({ status: "s", title: "t", message: "m" });
        answer.catch(() => {});
        vi.advanceTimersByTime(20);
        expect(listener).toHaveBeenCalled();
        off();
        task!.getPrompt().cancelPrompt();
    });
});

describe("Task.subscribe", () => {
    test("replays the current state by default and not with immediate: false", () => {
        const [task] = makeTasks(1);
        const eager = vi.fn();
        const quiet = vi.fn();
        task!.subscribe(eager);
        task!.subscribe(quiet, { immediate: false });
        expect(eager).toHaveBeenCalledTimes(1);
        expect(quiet).not.toHaveBeenCalled();

        task!.updateAttributes({ y: 1 });
        vi.advanceTimersByTime(20);
        expect(quiet).toHaveBeenCalledTimes(1);
    });
});

describe("pendingPrompts", () => {
    test("knows whether any task waits for the user, without looking at the tasks", async () => {
        const [a, b] = makeTasks(2);
        expect(pendingPrompts.hasAny()).toBe(false);
        const versionBefore = pendingPrompts.getVersion();

        const answer = a!.getPrompt().askInput({ status: "s", title: "t", message: "m" });
        expect(pendingPrompts.hasAny()).toBe(true);
        expect(pendingPrompts.getVersion()).toBeGreaterThan(versionBefore);

        const second = b!.getPrompt().askInput({ status: "s", title: "t", message: "m" });
        second.catch(() => {});
        a!.getPrompt().resolvePrompt("ok");
        await expect(answer).resolves.toBe("ok");
        expect(pendingPrompts.hasAny()).toBe(true); // b still waits

        b!.getPrompt().cancelPrompt();
        await expect(second).rejects.toThrow();
        expect(pendingPrompts.hasAny()).toBe(false);
    });

    test("tells its listeners when a prompt comes or goes, once per frame", async () => {
        const [a] = makeTasks(1);
        const listener = vi.fn();
        const off = pendingPrompts.subscribe(listener);
        const answer = a!.getPrompt().askInput({ status: "s", title: "t", message: "m" });
        vi.advanceTimersByTime(20);
        expect(listener).toHaveBeenCalledTimes(1);
        a!.getPrompt().resolvePrompt("x");
        vi.advanceTimersByTime(20);
        expect(listener).toHaveBeenCalledTimes(2);
        off();
        await answer;
    });
});
