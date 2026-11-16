import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Task, TaskAttributes } from "#base/task/task";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { globalLogger } from "#base/logger/logger";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { taskCursorBridge } from "#base/bridges/taskCursorBridge";
import { notificationScheduler } from "#base/notificationScheduler";
import { CollectionTask } from "#flows/musicDownloadFlow/utils/collectionTask";
import { taskLocks } from "#base/task/taskLock";
import { createTasksFromSnapshots } from "#flows/musicDownloadFlow/taskFactory";
import { reviveTrackTask } from "#flows/musicDownloadFlow/utils/buildTrackTask";
import type { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { computeTaskRevision } from "#flows/musicDownloadFlow/utils/taskRevision";
import { buildVisibleTaskOrder } from "#flows/musicDownloadFlow/utils/buildVisibleTaskOrder";
import {
    askGroupName,
    groupAndName,
    groupTracks,
    nextGroupName,
    reconcileGroups,
    removeFromGroups,
    ungroup,
} from "#flows/musicDownloadFlow/utils/groupTasks";
import type {
    CollectionDownloadTask,
    MusicDownloadTaskAttributes,
    TrackDownloadTask,
} from "#flows/musicDownloadFlow/types";

notificationScheduler.setSyncMode(true);

const orchestrator = TaskOrchestrator.getInstance();

// A real track: grouping moves it through `DownloadTask.setParent`, which checks the lock like every other edit.
const track = (id: string, extra: Record<string, unknown> = {}): Task<TaskAttributes> =>
    reviveTrackTask({
        id,
        attributes: {
            kind: "track",
            state: "pending",
            userInput: { type: "url", url: `https://example.com/${id}` },
            metadataGroups: [],
            metadataOverride: {},
            downloadSources: [],
            toTag: true,
            toDownload: false,
            ...extra,
        } as TrackDownloadTask,
    }) as unknown as Task<TaskAttributes>;

const album = (id: string, childTaskIds: string[]): CollectionTask =>
    new CollectionTask({
        id,
        attributes: {
            kind: "collection",
            collectionKind: "album",
            state: "finished",
            userInput: { type: "url", url: `https://open.spotify.com/album/${id}` },
            name: "An album",
            childTaskIds,
            collapsed: false,
        },
        logger: globalLogger,
    });

const ids = () => orchestrator.getTasks().map((t) => t.getId());
const visible = () => buildVisibleTaskOrder(orchestrator.getTasks()).map((t) => t.getId());
const attrsOf = (t: Task<TaskAttributes>) => t.getAttributes() as unknown as MusicDownloadTaskAttributes;
const groupAttrs = (t: Task<TaskAttributes> | CollectionTask) => t.getAttributes() as unknown as CollectionDownloadTask;
const parentOf = (id: string) =>
    (attrsOf(orchestrator.getTasks().find((t) => t.getId() === id)!) as { parentTaskId?: string }).parentTaskId;
const groups = () =>
    orchestrator.getTasks().filter((t) => (t as Task<TaskAttributes>).getAttributes()?.collectionKind === "group");

const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
    orchestrator.setTasks([track("a"), track("b"), track("c"), track("d"), track("e")]);
});

afterEach(() => {
    orchestrator.setTasks([]);
    dialogBridge.setInputOpener(null);
});

describe("groupTracks", () => {
    test("makes a group right where the first track was, with the tracks under it", () => {
        const group = groupTracks([orchestrator.getTasks()[1], orchestrator.getTasks()[2]])!;

        expect(group).toBeInstanceOf(CollectionTask);
        expect(ids()).toEqual(["a", group.getId(), "b", "c", "d", "e"]);
        expect(visible()).toEqual(["a", group.getId(), "b", "c", "d", "e"]);
        expect(parentOf("b")).toBe(group.getId());
        expect(parentOf("c")).toBe(group.getId());
        expect(parentOf("d")).toBeUndefined();
        expect(groupAttrs(group)).toMatchObject({
            kind: "collection",
            collectionKind: "group",
            name: "Group 1",
            childTaskIds: ["b", "c"],
            totalCount: 2,
            state: "finished",
            collapsed: false,
        });
    });

    test("takes the tracks in the order of the list, not the order they were selected in", () => {
        const all = orchestrator.getTasks();
        const group = groupTracks([all[3], all[0]])!;
        expect(groupAttrs(group).childTaskIds).toEqual(["a", "d"]);
        // The group is in front of the first of them.
        expect(ids().indexOf(group.getId())).toBe(0);
    });

    test("its TAG?/DL? boxes show what every track has", () => {
        const tasks = orchestrator.getTasks();
        tasks[1].updateAttributes({ toDownload: true });
        expect(groupAttrs(groupTracks([tasks[0], tasks[1]])!)).toMatchObject({ toTag: true, toDownload: false });

        tasks[3].updateAttributes({ toDownload: true });
        tasks[4].updateAttributes({ toDownload: true });
        expect(groupAttrs(groupTracks([tasks[3], tasks[4]])!)).toMatchObject({ toTag: true, toDownload: true });
    });

    test("ignores anything that is not a track, and does nothing when there is no track", () => {
        const albumTask = album("alb", []);
        orchestrator.addTasks([albumTask]);
        expect(groupTracks([albumTask])).toBeUndefined();
        expect(groups()).toHaveLength(0);

        const group = groupTracks([albumTask, orchestrator.getTasks()[0]])!;
        expect(groupAttrs(group).childTaskIds).toEqual(["a"]);
    });

    test("names the next group after the ones that exist", () => {
        const first = groupTracks([orchestrator.getTasks()[0]])!;
        const second = groupTracks([orchestrator.getTasks()[3]])!;
        expect(groupAttrs(first).name).toBe("Group 1");
        expect(groupAttrs(second).name).toBe("Group 2");
        expect(nextGroupName(["Group 1", "group 2", undefined])).toBe("Group 3");
        expect(nextGroupName(["Group 2"])).toBe("Group 1");
    });

    test("a track moved to a new group leaves the old one, and an emptied group goes away", () => {
        const tasks = orchestrator.getTasks();
        const first = groupTracks([tasks[0], tasks[1]])!;
        const second = groupTracks([orchestrator.getTasks().find((t) => t.getId() === "a")!])!;

        expect(parentOf("a")).toBe(second.getId());
        expect(parentOf("b")).toBe(first.getId());
        expect(groupAttrs(first).childTaskIds).toEqual(["b"]);

        // Moving the last one out removes the group it was alone in.
        const third = groupTracks([orchestrator.getTasks().find((t) => t.getId() === "b")!])!;
        expect(ids()).not.toContain(first.getId());
        expect(parentOf("b")).toBe(third.getId());
    });

    test("a track taken out of an album leaves the album's list, and the album stays", () => {
        orchestrator.setTasks([
            album("alb", ["x", "y"]),
            track("x", { parentTaskId: "alb" }),
            track("y", { parentTaskId: "alb" }),
        ]);
        const x = orchestrator.getTasks()[1];
        const group = groupTracks([x])!;

        expect(groupAttrs(orchestrator.getTasks()[0]).childTaskIds).toEqual(["y"]);
        expect(ids()).toContain("alb");
        expect(parentOf("x")).toBe(group.getId());
        expect(visible()).toEqual(["alb", "y", group.getId(), "x"]);
    });

    test("asks the list cursor to go to the new group", () => {
        const group = groupTracks([orchestrator.getTasks()[2]])!;
        // Looking does not consume it (a render can be thrown away); taking does, once.
        expect(taskCursorBridge.peek(["a", "b", group.getId()])).toBe(2);
        expect(taskCursorBridge.peek(["a", "b", group.getId()])).toBe(2);
        expect(taskCursorBridge.take(["a", "b", group.getId()])).toBe(2);
        expect(taskCursorBridge.take(["a", "b", group.getId()])).toBeUndefined();
        expect(taskCursorBridge.peek(["a", "b", group.getId()])).toBeUndefined();
    });

    test("the group is in the queue before the group it empties goes", () => {
        const first = groupTracks([orchestrator.getTasks()[0]])!;
        const seen: string[][] = [];
        const off = orchestrator.subscribe((o) => seen.push(o.getTasks().map((t) => t.getId())));
        seen.length = 0;

        // `a` leaves `first`, which is then empty and goes.
        const a = orchestrator.getTasks().find((t) => t.getId() === "a")!;
        const second = groupTracks([a, orchestrator.getTasks().find((t) => t.getId() === "d")!])!;
        off();

        expect(ids()).not.toContain(first.getId());
        expect(seen.length).toBeGreaterThan(0);
        // No notification shows a track pointing at a group that is not in the queue.
        for (const snapshot of seen) {
            expect(snapshot).toContain(second.getId());
        }
    });

    test("a track Claude holds is not moved, the others are", () => {
        const tasks = orchestrator.getTasks();
        const held = taskLocks.acquire(["b"], "agent");
        expect(held.ok).toBe(true);
        try {
            const group = groupTracks([tasks[0], tasks[1], tasks[2]])!;
            expect(groupAttrs(group).childTaskIds).toEqual(["a", "c"]);
            expect(parentOf("b")).toBeUndefined();

            // Only Claude's track is selected: nothing to group.
            expect(groupTracks([tasks[1]])).toBeUndefined();
            expect(groups()).toHaveLength(1);
        } finally {
            if (held.ok) held.lease.release();
        }
    });

    test("a held track stays in its group when it is removed or the group is dissolved", () => {
        const tasks = orchestrator.getTasks();
        const group = groupTracks([tasks[0], tasks[1]])!;
        const held = taskLocks.acquire(["a"], "agent");
        try {
            const both = ["a", "b"].map((id) => orchestrator.getTasks().find((t) => t.getId() === id)!);
            expect(removeFromGroups(both)).toBe(1);
            expect(parentOf("a")).toBe(group.getId());
            expect(parentOf("b")).toBeUndefined();

            // Dissolving a group with a held track is refused: its tracks would point at a group that is gone.
            expect(ungroup([group])).toBe(0);
            expect(ids()).toContain(group.getId());
            expect(parentOf("a")).toBe(group.getId());
        } finally {
            if (held.ok) held.lease.release();
        }
        expect(ungroup([group])).toBe(1);
        expect(parentOf("a")).toBeUndefined();
    });

    test("the group a track is in is part of its revision", () => {
        const a = orchestrator.getTasks()[0] as unknown as DownloadTask;
        const before = a.getRevision();
        const group = groupTracks([a as unknown as Task<TaskAttributes>])!;
        expect(a.getRevision()).not.toBe(before);
        const grouped = a.getRevision();
        ungroup([group]);
        // A fingerprint: back where it was, the revision is the one it had.
        expect(a.getRevision()).toBe(before);
        expect(grouped).not.toBe(before);
        expect(computeTaskRevision(a.getAttributes()!)).toBe(before);
    });
});

describe("a group is a collection that never fetches", () => {
    test("starting, restarting or refetching it changes nothing and keeps its tracks", async () => {
        const tasks = orchestrator.getTasks();
        const group = groupTracks([tasks[0], tasks[1]])!;
        const before = ids();

        await group.start();
        await group.restart();
        await group.refetch();

        expect(ids()).toEqual(before);
        expect(groupAttrs(group)).toMatchObject({ state: "finished", childTaskIds: ["a", "b"], name: "Group 1" });
        expect(group.getStatus().get().message).toBe("2 tracks");
    });

    test("is not picked up by Run all: it is already finished", () => {
        groupTracks([orchestrator.getTasks()[0]]);
        const candidates = orchestrator.getTasksCandidates().map((t) => t.getId());
        expect(candidates).toEqual(["a", "b", "c", "d", "e"]);
    });

    test("is not picked up by Run all after a save and a load either", () => {
        const group = groupTracks([orchestrator.getTasks()[0]])!;
        const snapshots = JSON.parse(JSON.stringify(orchestrator.getTasks().map((t) => t.get())));
        orchestrator.setTasks(createTasksFromSnapshots(snapshots));

        expect(orchestrator.getTasks().some((t) => t.getId() === group.getId())).toBe(true);
        expect(orchestrator.getTasksCandidates().map((t) => t.getId())).toEqual(["a", "b", "c", "d", "e"]);
    });
    test("survives a save and a load (session snapshot round trip), tracks still under it", () => {
        const tasks = orchestrator.getTasks();
        const group = groupTracks([tasks[1], tasks[2]])!;
        group.rename("Road trip");
        const snapshots = JSON.parse(JSON.stringify(orchestrator.getTasks().map((t) => t.get())));

        const revived = createTasksFromSnapshots(snapshots);
        const revivedGroup = revived.find((t) => t.getId() === group.getId())!;

        expect(revivedGroup).toBeInstanceOf(CollectionTask);
        expect((revivedGroup as CollectionTask).isGroup()).toBe(true);
        expect(groupAttrs(revivedGroup as CollectionTask)).toMatchObject({
            collectionKind: "group",
            name: "Road trip",
            childTaskIds: ["b", "c"],
        });
        expect(buildVisibleTaskOrder(revived as unknown as Task<TaskAttributes>[]).map((t) => t.getId())).toEqual(
            buildVisibleTaskOrder(orchestrator.getTasks()).map((t) => t.getId())
        );
    });
});

describe("rename", () => {
    test("trims and collapses whitespace, and refuses an empty name or the same one", () => {
        const group = groupTracks([orchestrator.getTasks()[0]])!;
        expect(group.rename("  Road   trip \n")).toBe(true);
        expect(groupAttrs(group).name).toBe("Road trip");
        expect(group.rename("Road trip")).toBe(false);
        expect(group.rename("   ")).toBe(false);
        expect(groupAttrs(group).name).toBe("Road trip");
    });

    test("an album keeps the platform's name", () => {
        const albumTask = album("alb", []);
        expect(albumTask.rename("Mine")).toBe(false);
        expect(groupAttrs(albumTask).name).toBe("An album");
    });

    test("askGroupName applies the answer, and Esc (null) or nobody to ask keeps the name", async () => {
        const group = groupTracks([orchestrator.getTasks()[0]])!;

        // Nobody to ask: no input UI mounted.
        await askGroupName(group);
        expect(groupAttrs(group).name).toBe("Group 1");

        let asked: { title: string; initialValue?: string } | undefined;
        let answerWith: string | null = "Mixtape";
        dialogBridge.setInputOpener((dialog, resolve) => {
            asked = dialog;
            resolve(answerWith);
        });
        await askGroupName(group);
        expect(asked).toMatchObject({ title: "Rename group", initialValue: "Group 1" });
        expect(groupAttrs(group).name).toBe("Mixtape");

        answerWith = null;
        await askGroupName(group);
        expect(groupAttrs(group).name).toBe("Mixtape");
    });

    test("Ctrl+G groups first, then asks for the name with the default one filled in", async () => {
        let initial: string | undefined;
        dialogBridge.setInputOpener((dialog, resolve) => {
            initial = dialog.initialValue;
            resolve("Party");
        });
        await groupAndName([orchestrator.getTasks()[0], orchestrator.getTasks()[1]]);
        expect(initial).toBe("Group 1");
        expect(groupAttrs(groups()[0] as unknown as CollectionTask)).toMatchObject({
            name: "Party",
            childTaskIds: ["a", "b"],
        });
    });

    test("Ctrl+G with no track selected asks nothing and makes nothing", async () => {
        let asked = false;
        dialogBridge.setInputOpener((_d, resolve) => {
            asked = true;
            resolve("x");
        });
        await groupAndName([]);
        expect(asked).toBe(false);
        expect(groups()).toHaveLength(0);
    });
});

describe("removeFromGroups / ungroup", () => {
    test("takes tracks out of their group; the last one out removes the group", () => {
        const tasks = orchestrator.getTasks();
        const group = groupTracks([tasks[0], tasks[1], tasks[2]])!;

        expect(removeFromGroups([orchestrator.getTasks().find((t) => t.getId() === "a")!])).toBe(1);
        expect(parentOf("a")).toBeUndefined();
        expect(groupAttrs(group).childTaskIds).toEqual(["b", "c"]);

        const rest = ["b", "c"].map((id) => orchestrator.getTasks().find((t) => t.getId() === id)!);
        expect(removeFromGroups(rest)).toBe(2);
        expect(ids()).not.toContain(group.getId());
        expect(ids().sort()).toEqual(["a", "b", "c", "d", "e"]);
    });

    test("leaves a track of an album alone: only groups are left by this", () => {
        orchestrator.setTasks([album("alb", ["x"]), track("x", { parentTaskId: "alb" })]);
        expect(removeFromGroups([orchestrator.getTasks()[1]])).toBe(0);
        expect(parentOf("x")).toBe("alb");
    });

    test("ungroup dissolves the group and keeps its tracks in the list", () => {
        const tasks = orchestrator.getTasks();
        const group = groupTracks([tasks[1], tasks[2]])!;
        const albumTask = album("alb", []);
        orchestrator.addTasks([albumTask]);

        // An album in the same call is not a group: it stays.
        expect(ungroup([group, albumTask])).toBe(1);
        expect(ids()).toEqual(["a", "b", "c", "d", "e", "alb"]);
        expect(parentOf("b")).toBeUndefined();
        expect(parentOf("c")).toBeUndefined();
    });
});

describe("reconcileGroups", () => {
    test("follows the tracks that point at the group: one deleted on its own leaves the count", () => {
        const tasks = orchestrator.getTasks();
        const group = groupTracks([tasks[0], tasks[1], tasks[2]])!;

        orchestrator.removeTasks(["b"]);
        reconcileGroups(orchestrator.getTasks());

        expect(groupAttrs(group)).toMatchObject({ childTaskIds: ["a", "c"], totalCount: 2 });
        expect(group.getStatus().get().message).toBe("2 tracks");
    });

    test("a track restored later (it still points at the group) comes back into the count", () => {
        const tasks = orchestrator.getTasks();
        const group = groupTracks([tasks[0], tasks[1]])!;
        const b = orchestrator.getTasks().find((t) => t.getId() === "b")!;

        orchestrator.removeTasks(["b"]);
        reconcileGroups(orchestrator.getTasks());
        expect(groupAttrs(group).childTaskIds).toEqual(["a"]);

        orchestrator.addTasks([b]);
        reconcileGroups(orchestrator.getTasks());
        expect(groupAttrs(group)).toMatchObject({ childTaskIds: ["a", "b"], totalCount: 2 });
    });

    test("does not remove a group that lost its tracks (a restore may be on its way), and leaves albums alone", () => {
        orchestrator.setTasks([album("alb", ["gone"])]);
        const t = track("t");
        orchestrator.addTasks([t]);
        const made = groupTracks([t])!;
        orchestrator.removeTasks(["t"]);
        reconcileGroups(orchestrator.getTasks());

        expect(ids()).toContain(made.getId());
        expect(groupAttrs(made).childTaskIds).toEqual([]);
        expect(groupAttrs(orchestrator.getTasks()[0]).childTaskIds).toEqual(["gone"]);
    });
});

describe("orchestrator.addTasks({ before })", () => {
    test("puts the new tasks in front of that task, and at the end when it is not there", () => {
        orchestrator.addTasks([track("x")], { before: "c" });
        expect(ids()).toEqual(["a", "b", "x", "c", "d", "e"]);

        orchestrator.addTasks([track("y")], { before: "nope" });
        orchestrator.addTasks([track("z")]);
        expect(ids()).toEqual(["a", "b", "x", "c", "d", "e", "y", "z"]);
    });

    test("still refuses an id that is already in the queue", () => {
        expect(() => orchestrator.addTasks([track("a")], { before: "c" })).toThrow(/already in the queue/);
    });
});

describe("dialogBridge.input", () => {
    test("resolves null when nobody can ask", async () => {
        expect(await dialogBridge.input({ title: "x" })).toBeNull();
    });

    test("answers with the text, one dialog at a time", async () => {
        const shown: string[] = [];
        const answers: ((v: string | null) => void)[] = [];
        dialogBridge.setInputOpener((d, resolve) => {
            shown.push(d.title);
            answers.push(resolve);
        });

        const one = dialogBridge.input({ title: "one" });
        const two = dialogBridge.input({ title: "two" });
        await tick();
        expect(shown).toEqual(["one"]);

        answers[0]("hello");
        expect(await one).toBe("hello");
        await tick();
        expect(shown).toEqual(["one", "two"]);

        answers[1](null);
        expect(await two).toBeNull();
    });

    test("the UI going away answers the dialog on screen and the ones waiting with null", async () => {
        dialogBridge.setInputOpener(() => {
            /* shown, never answered */
        });
        const onScreen = dialogBridge.input({ title: "one" });
        const waiting = dialogBridge.input({ title: "two" });
        dialogBridge.setInputOpener(null);
        expect(await onScreen).toBeNull();
        expect(await waiting).toBeNull();
    });
});
