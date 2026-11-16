import { randomUUID } from "node:crypto";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { taskCursorBridge } from "#base/bridges/taskCursorBridge";
import { globalLogger } from "#base/logger/logger";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { type Task } from "#base/task/task";
import { StatusType } from "#base/task/task-status";
import { type CollectionDownloadTask, type MusicDownloadTaskAttributes } from "../types";
import { CollectionTask } from "./collectionTask";
import { runUserEdit, type DownloadTask } from "./downloadTask";

/**
 * Groups made by hand (Ctrl+G): a `CollectionTask` of kind "group" whose tracks are tagged with its id (`parentTaskId`),
 * the same way an album's or playlist's are. The list shows a group like an album (the tracks right under it, foldable)
 * and Archive / Delete cascade to its tracks. What is different: it has no link and nothing to fetch, its name is the
 * user's, and it lives only as long as it holds a track.
 */

const logger = globalLogger.createChild({ service: "MusicDownload" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTask = Task<any>;

const attrsOf = (t: AnyTask) => t.getAttributes() as MusicDownloadTaskAttributes | undefined;
const isTrack = (t: AnyTask): boolean => attrsOf(t)?.kind === "track";

/** An album or playlist is not a group: its tracks come from the platform. */
export const isGroupTask = (t: AnyTask): boolean => {
    const a = attrsOf(t);
    return a?.kind === "collection" && a.collectionKind === "group";
};

const asGroup = (t: AnyTask): CollectionTask => t as unknown as CollectionTask;
/**
 * Whether the user may move this track now. A track Claude holds is refused (and the reason is logged), as every other
 * edit of a track is: moving it would change what Claude is working on under its feet.
 */
const canMove = (t: AnyTask): boolean => runUserEdit(() => (t as unknown as DownloadTask).assertWritable());

/** Sets (or, with undefined, clears) the collection a track belongs to. Only for tracks that passed `canMove`. */
const setParent = (t: AnyTask, parentTaskId: string | undefined): void =>
    void runUserEdit(() => (t as unknown as DownloadTask).setParent(parentTaskId));

const plural = (n: number): string => `${n} track${n === 1 ? "" : "s"}`;

/** "Group 1", "Group 2"…: the first one no group has yet (a renamed or removed group frees its number). */
export function nextGroupName(existing: Iterable<string | undefined>): string {
    const taken = new Set([...existing].map((n) => n?.toLowerCase()));
    for (let n = 1; ; n++) {
        const candidate = `Group ${n}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

/**
 * Takes tracks out of the collection each one is in (`onlyGroups`: only out of groups, an album keeps its tracks).
 * Returns the ids of groups left with no track: the caller removes them, once it has put the tracks elsewhere.
 * It does not touch the tracks themselves: their `parentTaskId` is the caller's to set.
 */
function detachFromParents(members: AnyTask[], all: readonly AnyTask[], onlyGroups: boolean): string[] {
    const byId = new Map(all.map((t) => [t.getId(), t]));
    const leaving = new Map<string, Set<string>>();
    for (const member of members) {
        const a = attrsOf(member);
        const parentId = a?.kind === "track" ? a.parentTaskId : undefined;
        const parent = parentId ? byId.get(parentId) : undefined;
        if (!parentId || !parent || attrsOf(parent)?.kind !== "collection") continue;
        if (onlyGroups && !isGroupTask(parent)) continue;
        const ids = leaving.get(parentId) ?? new Set<string>();
        ids.add(member.getId());
        leaving.set(parentId, ids);
    }
    if (leaving.size === 0) return [];

    const memberCount = new Map<string, number>();
    for (const t of all) {
        const a = attrsOf(t);
        if (a?.kind === "track" && a.parentTaskId)
            memberCount.set(a.parentTaskId, (memberCount.get(a.parentTaskId) ?? 0) + 1);
    }

    const emptied: string[] = [];
    for (const [parentId, ids] of leaving) {
        const parent = byId.get(parentId)!;
        const collection = asGroup(parent);
        const remaining = (collection.getAttributes()?.childTaskIds ?? []).filter((id) => !ids.has(id));
        if (isGroupTask(parent)) {
            if ((memberCount.get(parentId) ?? 0) - ids.size <= 0) emptied.push(parentId);
            else collection.setMembers(remaining);
        } else {
            collection.updateAttributes({ childTaskIds: remaining });
        }
    }
    return emptied;
}

/**
 * Puts the tracks among `tasks` (anything else is ignored: a group is not nested in another) in a new group, in front of
 * the first of them. A track that was in a group or an album leaves it; a group that ends up empty goes away.
 * Returns the new group, or undefined when there was no track to group.
 */
export function groupTracks(tasks: readonly AnyTask[], name?: string): CollectionTask | undefined {
    const orchestrator = TaskOrchestrator.getInstance();
    const all = orchestrator.getTasks();
    const wanted = new Set(tasks.filter(isTrack).map((t) => t.getId()));
    // In the order of the queue, which is the order the list shows: not the order the user selected them in.
    const members = all.filter((t) => wanted.has(t.getId()) && isTrack(t) && canMove(t));
    if (members.length === 0) return undefined;

    const emptied = detachFromParents(members, all, false);

    const flag = (key: "toTag" | "toDownload"): boolean =>
        members.every((m) => (attrsOf(m) as { toTag?: boolean; toDownload?: boolean } | undefined)?.[key] === true);
    const attributes: CollectionDownloadTask = {
        kind: "collection",
        collectionKind: "group",
        state: "finished",
        userInput: { type: "url", url: "" },
        name: name ?? nextGroupName(all.filter(isGroupTask).map((g) => asGroup(g).getAttributes()?.name)),
        childTaskIds: members.map((m) => m.getId()),
        totalCount: members.length,
        collapsed: false,
        // The checkboxes of the group show what every track has, and a click sets all of them (see toggleCollectionFlag).
        toTag: flag("toTag"),
        toDownload: flag("toDownload"),
    };
    // (A group has nothing to run: `CollectionTask` marks it finished itself, so "Run all" never picks it up, new or
    // loaded from a session.)
    const group = new CollectionTask({
        id: `group-${randomUUID()}`,
        attributes,
        logger,
        initialStatus: { type: StatusType.Success, message: plural(members.length) },
    });

    for (const member of members) setParent(member, group.getId());
    // The cursor follows the new row, so it is on the group (renaming it, ungrouping it) and not on one of its tracks.
    taskCursorBridge.request(group.getId());
    // The group first, the emptied ones after: the tracks point at the group from the first notification on, and the
    // group is already in the queue when the old one goes.
    orchestrator.addTasks([group], { before: members[0].getId() });
    if (emptied.length > 0) orchestrator.removeTasks(emptied);
    logger.info(`Grouped ${plural(members.length)} as "${attributes.name}"`);
    return group;
}

/** Takes the tracks among `tasks` out of their group (an album keeps its tracks). Returns how many left. */
export function removeFromGroups(tasks: readonly AnyTask[]): number {
    const orchestrator = TaskOrchestrator.getInstance();
    const all = orchestrator.getTasks();
    const wanted = new Set(tasks.filter(isTrack).map((t) => t.getId()));
    const byId = new Map(all.map((t) => [t.getId(), t]));
    const members = all.filter((t) => {
        if (!wanted.has(t.getId())) return false;
        const a = attrsOf(t);
        const parent = a?.kind === "track" && a.parentTaskId ? byId.get(a.parentTaskId) : undefined;
        return parent !== undefined && isGroupTask(parent) && canMove(t);
    });
    if (members.length === 0) return 0;

    const emptied = detachFromParents(members, all, true);
    for (const member of members) setParent(member, undefined);
    if (emptied.length > 0) orchestrator.removeTasks(emptied);
    return members.length;
}

/** Dissolves the groups among `tasks`: their tracks stay in the list, on their own. Returns how many groups went. */
export function ungroup(tasks: readonly AnyTask[]): number {
    const orchestrator = TaskOrchestrator.getInstance();
    const wanted = new Set(tasks.filter(isGroupTask).map((g) => g.getId()));
    if (wanted.size === 0) return 0;
    const membersOf = new Map<string, AnyTask[]>();
    for (const t of orchestrator.getTasks()) {
        const a = attrsOf(t);
        if (a?.kind === "track" && a.parentTaskId && wanted.has(a.parentTaskId)) {
            const list = membersOf.get(a.parentTaskId) ?? [];
            list.push(t);
            membersOf.set(a.parentTaskId, list);
        }
    }
    // A group with a track Claude holds stays as it is: its tracks would be left pointing at a group that is gone.
    const groupIds = [...wanted].filter((id) => (membersOf.get(id) ?? []).every(canMove));
    for (const id of groupIds) for (const t of membersOf.get(id) ?? []) setParent(t, undefined);
    if (groupIds.length > 0) orchestrator.removeTasks(groupIds);
    return groupIds.length;
}

/**
 * Keeps each group's member list and count true to the tracks that point at it (`parentTaskId`, which is what the list
 * shows): a track deleted or archived on its own leaves the count, one restored from the archive comes back into it.
 * Cheap when there is no group; a group whose list is already right is not touched.
 */
export function reconcileGroups(tasks: readonly AnyTask[]): void {
    const groups = tasks.filter(isGroupTask);
    if (groups.length === 0) return;
    const membersOf = new Map<string, string[]>();
    for (const t of tasks) {
        const a = attrsOf(t);
        if (a?.kind !== "track" || !a.parentTaskId) continue;
        const list = membersOf.get(a.parentTaskId) ?? [];
        list.push(t.getId());
        membersOf.set(a.parentTaskId, list);
    }
    for (const group of groups) asGroup(group).setMembers(membersOf.get(group.getId()) ?? []);
}

/** Asks for a group's name and applies it. Esc (or nobody to ask) leaves the name as it is. */
export async function askGroupName(
    group: CollectionTask,
    options: { title?: string; message?: string } = {}
): Promise<void> {
    const attrs = group.getAttributes();
    const answer = await dialogBridge.input({
        title: options.title ?? "Rename group",
        message: options.message ?? plural(attrs?.childTaskIds.length ?? 0),
        initialValue: attrs?.name,
    });
    if (answer !== null) group.rename(answer);
}

/** Ctrl+G: groups the tracks among `tasks`, then asks for the name (Esc keeps the default one). */
export async function groupAndName(tasks: readonly AnyTask[]): Promise<void> {
    const group = groupTracks(tasks);
    if (!group) {
        logger.info("Nothing to group: select at least one track");
        return;
    }
    const name = group.getAttributes()?.name ?? "";
    await askGroupName(group, {
        title: "Name this group",
        message: `${plural(group.getAttributes()?.childTaskIds.length ?? 0)}. Esc keeps "${name}".`,
    });
}
