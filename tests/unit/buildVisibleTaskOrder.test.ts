import { describe, test, expect } from "vitest";
import { Task, TaskAttributes } from "#base/task/task";
import { globalLogger } from "#base/logger/logger";
import { buildVisibleTaskOrder } from "#flows/musicDownloadFlow/utils/buildVisibleTaskOrder";

function makeTask(id: string, attributes: TaskAttributes): Task<TaskAttributes> {
    return new Task({ id, attributes, logger: globalLogger });
}

describe("buildVisibleTaskOrder", () => {
    test("keeps plain (non-collection) tasks in their original order", () => {
        const tasks = [makeTask("a", { kind: "track" }), makeTask("b", { kind: "track" })];
        expect(buildVisibleTaskOrder(tasks).map((t) => t.getId())).toEqual(["a", "b"]);
    });

    test("places children immediately after their parent, wherever they sit in the array", () => {
        const parent = makeTask("p", { kind: "collection", collapsed: false });
        const child1 = makeTask("c1", { kind: "track", parentTaskId: "p" });
        const child2 = makeTask("c2", { kind: "track", parentTaskId: "p" });
        const other = makeTask("o", { kind: "track" });
        // Children land at the end of the array, as they do after orchestrator.addTasks()
        // is called from CollectionTask.start() — well after the parent was first added.
        const tasks = [parent, other, child1, child2];

        expect(buildVisibleTaskOrder(tasks).map((t) => t.getId())).toEqual(["p", "c1", "c2", "o"]);
    });

    test("hides a collapsed parent's children entirely", () => {
        const parent = makeTask("p", { kind: "collection", collapsed: true });
        const child = makeTask("c1", { kind: "track", parentTaskId: "p" });

        expect(buildVisibleTaskOrder([parent, child]).map((t) => t.getId())).toEqual(["p"]);
    });

    test("shows children again once the parent is expanded", () => {
        const parent = makeTask("p", { kind: "collection", collapsed: false });
        const child = makeTask("c1", { kind: "track", parentTaskId: "p" });

        expect(buildVisibleTaskOrder([parent, child]).map((t) => t.getId())).toEqual(["p", "c1"]);
    });

    test("treats a track whose parent no longer exists as a normal top-level row", () => {
        const orphan = makeTask("c1", { kind: "track", parentTaskId: "deleted-parent" });

        expect(buildVisibleTaskOrder([orphan]).map((t) => t.getId())).toEqual(["c1"]);
    });

    test("supports multiple independent collections", () => {
        const p1 = makeTask("p1", { kind: "collection", collapsed: false });
        const p1c1 = makeTask("p1c1", { kind: "track", parentTaskId: "p1" });
        const p2 = makeTask("p2", { kind: "collection", collapsed: true });
        const p2c1 = makeTask("p2c1", { kind: "track", parentTaskId: "p2" });

        const tasks = [p1, p2, p1c1, p2c1];
        expect(buildVisibleTaskOrder(tasks).map((t) => t.getId())).toEqual(["p1", "p1c1", "p2"]);
    });
});
