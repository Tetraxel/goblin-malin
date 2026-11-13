import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Task } from "#base/task/task";
import { globalLogger } from "#base/logger/logger";
import { notificationScheduler } from "#base/notificationScheduler";
import { useActivePrompt } from "#components/PromptModal/useActivePrompt";
import { mountHook, tick } from "./helpers/mountHook";

const makeTasks = (count: number): Task[] =>
    Array.from({ length: count }, (_, i) => new Task({ id: `t${i}`, attributes: {}, logger: globalLogger }));

beforeEach(() => notificationScheduler.setSyncMode(true));
afterEach(() => notificationScheduler.setSyncMode(false));

type Active = ReturnType<typeof useActivePrompt>;

describe("useActivePrompt — finds the pending prompt without subscribing to the tasks", () => {
    test("nothing pending: no task, and a new list changes nothing", async () => {
        const tasks = makeTasks(3);
        const hook = mountHook<Task[], Active>((t) => useActivePrompt(t), tasks);
        expect(hook.current().task).toBeNull();
        hook.rerender([...tasks, ...makeTasks(2)]);
        await tick();
        expect(hook.current().task).toBeNull();
    });

    test("shows the first task (in list order) that asks, and keeps it until it is answered", async () => {
        const tasks = makeTasks(5);
        const hook = mountHook<Task[], Active>((t) => useActivePrompt(t), tasks);

        const late = tasks[3]!.getPrompt().askInput({ status: "s", title: "t", message: "m" });
        await tick();
        expect(hook.current().task).toBe(tasks[3]);

        // An earlier task asks too: the one on screen stays until it is answered.
        const early = tasks[1]!.getPrompt().askInput({ status: "s", title: "t", message: "m" });
        await tick();
        expect(hook.current().task).toBe(tasks[3]);

        tasks[3]!.getPrompt().resolvePrompt("a");
        await late;
        await tick();
        expect(hook.current().task).toBe(tasks[1]);

        tasks[1]!.getPrompt().resolvePrompt("b");
        await early;
        await tick();
        expect(hook.current().task).toBeNull();
    });

    test("a prompt that was already pending when the list is replaced is found", async () => {
        const first = makeTasks(2);
        const hook = mountHook<Task[], Active>((t) => useActivePrompt(t), first);
        const other = makeTasks(3);
        const answer = other[2]!.getPrompt().askInput({ status: "s", title: "t", message: "m" });
        await tick();
        expect(hook.current().task).toBeNull(); // not in the list yet
        hook.rerender(other);
        await tick();
        expect(hook.current().task).toBe(other[2]);
        other[2]!.getPrompt().resolvePrompt("x");
        await answer;
    });
});
