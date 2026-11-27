import { AppEventBus } from "#base/appEvents";
import { Task } from "#base/task/task";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { appReady } from "#base/appReady";
import { type ExtensionEvents } from "#extensions/api/types";
import { collectionView, trackView } from "./publicViews";
import { type CollectionDownloadTask, type MusicDownloadTaskAttributes } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTask = Task<any>;

/**
 * What happened in the music app, for code outside the pipeline (extensions, P34). The pipeline emits; nothing in it
 * waits for, or depends on, a handler (see `AppEventBus`).
 */
export const musicEvents = new AppEventBus<ExtensionEvents>();

/** `track.saved`, from the place the saved file is recorded. */
export function emitTrackSaved(task: AnyTask, path: string): void {
    if (!musicEvents.hasListeners("track.saved")) return;
    musicEvents.emit(
        "track.saved",
        () => {
            const track = trackView(task);
            return { track, path, format: track.savedFile?.format ?? path.split(".").pop()?.toLowerCase() ?? "" };
        },
        task.getId()
    );
}

/** `track.failed`, from the run's error path. */
export function emitTrackFailed(task: AnyTask, stage: "metadata" | "download" | "run", error: unknown): void {
    if (!musicEvents.hasListeners("track.failed")) return;
    const message = error instanceof Error ? error.message : String(error);
    musicEvents.emit("track.failed", () => ({ track: trackView(task), stage, message }), task.getId());
}

/** `stems.saved`, once stems were written into the library. */
export function emitStemsSaved(task: AnyTask, kinds: readonly string[]): void {
    if (kinds.length === 0 || !musicEvents.hasListeners("stems.saved")) return;
    musicEvents.emit(
        "stems.saved",
        () => {
            const track = trackView(task);
            const stems: Record<string, string> = {};
            for (const kind of kinds) if (track.stems[kind]) stems[kind] = track.stems[kind];
            return { track, stems };
        },
        task.getId()
    );
}

/** `tasks.added`, from the one place tasks join the list. */
export function emitTasksAdded(ids: readonly string[]): void {
    if (ids.length === 0 || !musicEvents.hasListeners("tasks.added")) return;
    musicEvents.emit("tasks.added", { ids: [...ids] });
}

let collectionWatch: (() => void) | undefined;
let appReadyWired = false;

/**
 * `collection.done` is derived, not emitted by the collection itself: a collection is done when it has tracks and
 * every one of them is saved or failed. Watched with `Task.subscribeToAny` (once per frame, never a subscription per
 * task), and only once someone listens.
 *
 * A collection is announced only for something that happens to it while it is in the list: one that is already done
 * the first time the watch sees it (the session loaded after the extension, a session switched to, an archived album
 * restored) is taken as done silently. Tracked by task object, not by id: opening a session makes new objects.
 */
export function watchCollectionsDone(): void {
    if (collectionWatch) return;
    const seen = new WeakSet<AnyTask>();
    const done = new WeakSet<AnyTask>();
    const look = (announce: boolean): void => {
        const orchestrator = TaskOrchestrator.getInstance();
        for (const task of orchestrator.getTasks()) {
            const attrs = task.getAttributes() as MusicDownloadTaskAttributes | undefined;
            if (attrs?.kind !== "collection") continue;
            const first = !seen.has(task);
            seen.add(task);
            // Already there when the list was replaced (a session opened): nothing to announce, only to remember.
            if (announce === false && !first) continue;
            const counts = countChildren(attrs, (id) => orchestrator.getTask(id));
            const isDone = counts.total > 0 && counts.saved + counts.failed === counts.total;
            if (!isDone) {
                done.delete(task);
                continue;
            }
            if (done.has(task)) continue;
            done.add(task);
            if (!first) musicEvents.emit("collection.done", () => ({ collection: collectionView(task), ...counts }));
        }
    };
    // Whenever the list is replaced or grows, what is in it is taken in without announcing anything; only the changes
    // that come after are announced.
    look(false);
    const offList = TaskOrchestrator.getInstance().subscribe(() => look(false));
    const offTasks = Task.subscribeToAny(() => look(true));
    collectionWatch = () => {
        offList();
        offTasks();
    };
}

function countChildren(
    attrs: CollectionDownloadTask,
    get: (id: string) => AnyTask | undefined
): { saved: number; failed: number; total: number } {
    let saved = 0;
    let failed = 0;
    let total = 0;
    for (const id of attrs.childTaskIds ?? []) {
        const child = get(id);
        if (!child) continue;
        total++;
        const a = child.getAttributes() as MusicDownloadTaskAttributes | undefined;
        if (a?.kind !== "track" || child.isBusy()) continue;
        if (a.savedFile) saved++;
        else if (a.state === "failed") failed++;
    }
    return { saved, failed, total };
}

/** `app.ready`, once the UI is up (wired once, the first time someone listens). */
export function wireAppReadyEvent(): void {
    if (appReadyWired) return;
    appReadyWired = true;
    appReady.whenReady(() => musicEvents.emit("app.ready", {}));
}

/** Tests. */
export function resetMusicEvents(): void {
    collectionWatch?.();
    collectionWatch = undefined;
    appReadyWired = false;
    musicEvents.clear();
}
