import { TaskOrchestrator } from "#base/task/orchestrator";
import { Task as TaskClass } from "#base/task/task";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { taskSelectionBridge } from "#base/bridges/taskSelectionBridge";
import { urlParserRegistry } from "#base/urlParser";
import { SessionManager } from "#sessions/sessionManager";
import { getArchivedTaskIds } from "#sessions/archive";
import { DownloadTask, TaskLockedError } from "#flows/musicDownloadFlow/utils/downloadTask";
import { createTasksFromUrls, importTasks } from "#flows/musicDownloadFlow/taskFactory";
import { runSelected, stopAll } from "#flows/musicDownloadFlow/runController";
import { taskIdFromUrl } from "#flows/musicDownloadFlow/utils/taskId";
import { withoutBusy } from "#flows/musicDownloadFlow/utils/busyTasks";
import { downloadSourceIds } from "#flows/musicDownloadFlow/utils/taskRevision";
import { OverrideValidationError } from "#flows/musicDownloadFlow/utils/overrideValidation";
import { taskView, trackView } from "#flows/musicDownloadFlow/publicViews";
import { type TrackDownloadTask } from "#flows/musicDownloadFlow/types";
import { type LockHolder } from "#base/task/taskLock";
import { type ExtensionTasks, type TaskFilter, type TaskView, type TrackEditor, type TrackView } from "./types";

/** A write an extension asked for that was refused: the message says why (busy, held by Claude, invalid value…). */
export class ExtensionWriteError extends Error {
    constructor(
        message: string,
        public readonly code: "busy" | "locked" | "invalid" | "not-found" | "not-a-track" | "failed" = "failed"
    ) {
        super(message);
        this.name = "ExtensionWriteError";
    }
}

const orchestrator = () => TaskOrchestrator.getInstance();

function matches(view: TaskView, filter: TaskFilter): boolean {
    if (filter.kind && view.kind !== filter.kind) return false;
    if (filter.state && view.state !== filter.state) return false;
    if (filter.parentId !== undefined && (view.kind !== "track" || view.parentId !== filter.parentId)) return false;
    if (filter.saved !== undefined && (view.kind !== "track" || !!view.savedFile !== filter.saved)) return false;
    if (filter.query) {
        const q = filter.query.toLowerCase();
        const text =
            view.kind === "track"
                ? [view.title, ...view.artists, view.album, view.url].join(" ")
                : [view.name, view.url].join(" ");
        if (!text.toLowerCase().includes(q)) return false;
    }
    return true;
}

export function requireTrack(id: string): DownloadTask {
    const task = orchestrator().getTask(id) ?? orchestrator().getTask(`task:${id}`);
    if (!task) throw new ExtensionWriteError(`No task with id "${id}"`, "not-found");
    if (!(task instanceof DownloadTask)) throw new ExtensionWriteError(`Task ${id} is not a track`, "not-a-track");
    return task;
}

const queues = new Map<string, Promise<unknown>>();

/** One write at a time per track, whoever asks (two extensions, or one extension twice). */
function serialised<R>(taskId: string, run: () => Promise<R>): Promise<R> {
    const previous = queues.get(taskId) ?? Promise.resolve();
    const mine = previous.then(run);
    const tail = mine.then(
        () => undefined,
        () => undefined
    );
    queues.set(taskId, tail);
    return mine.finally(() => {
        if (queues.get(taskId) === tail) queues.delete(taskId);
    });
}

/**
 * Every change an extension makes to a track goes through here: like the agent's `agentWrite()`, without the turn's
 * budget and the undo journal. It refuses a busy track (the pipeline is its busiest writer) and, through the named
 * method's own `assertWritable`, a track Claude holds. The named method validates the value.
 */
export function extensionWrite<T>(
    task: DownloadTask,
    change: () => T | Promise<T>,
    options: { allowBusy?: boolean } = {}
): Promise<T> {
    return serialised(task.getId(), async () => {
        if (!options.allowBusy && task.isBusy()) {
            throw new ExtensionWriteError(
                `Task ${task.getId()} is being processed right now; try again once it is done`,
                "busy"
            );
        }
        try {
            return await change();
        } catch (error) {
            if (error instanceof TaskLockedError) {
                throw new ExtensionWriteError(`Claude is working on task ${task.getId()} right now`, "locked");
            }
            if (error instanceof OverrideValidationError) throw new ExtensionWriteError(error.message, "invalid");
            throw error;
        }
    });
}

/** Artist names as plain text become the artist objects the panel stores. */
function normalisePatch(patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...patch };
    if (Array.isArray(out.artists)) {
        out.artists = out.artists.map((a) => (typeof a === "string" ? { type: "artist", name: a } : a));
    }
    if (Array.isArray(out.genres)) out.genres = out.genres.map((g) => String(g));
    return out;
}

function rowIndex(task: DownloadTask, downloadId: string): number {
    const ids = downloadSourceIds((task.getAttributes() as TrackDownloadTask).downloadSources ?? []);
    const index = ids.indexOf(downloadId);
    if (index === -1) throw new ExtensionWriteError(`No download "${downloadId}" on task ${task.getId()}`, "not-found");
    return index;
}

type EditorMode = {
    /** Who the named methods are called as: the user's side (an extension acting for them) or Claude (a chat tool). */
    actor: LockHolder;
    /** How each change runs: through {@link extensionWrite}, or directly (a chat tool's `agentWrite` guards it). */
    guard: <T>(task: DownloadTask, change: () => T | Promise<T>) => Promise<T>;
};

const USER_MODE: EditorMode = { actor: "user", guard: (task, change) => extensionWrite(task, change) };

export function createTrackEditor(id: string, mode: EditorMode = USER_MODE): TrackEditor {
    const task = requireTrack(id);
    const as = { actor: mode.actor };
    const extensionWrite = mode.guard;
    const after = (): TrackView => trackView(task);
    return {
        id: task.getId(),
        patchMetadata: (patch) =>
            extensionWrite(task, () => {
                task.patchMetadataOverride(normalisePatch(patch), as);
                return after();
            }),
        addSources: (urls) =>
            extensionWrite(task, async () => {
                const result = await task.addUserSources(urls, as);
                return { added: result.added.map((s) => s.url), skipped: result.skipped };
            }),
        removeSource: (url) =>
            extensionWrite(task, () => {
                const entry = (task.getAttributes()?.userSources ?? []).find((s) => s.url === url || s.uri === url);
                return entry ? task.removeUserSource(entry.uri, as) : false;
            }),
        selectDownload: (downloadId) =>
            extensionWrite(task, () => {
                task.selectDownloadSource(rowIndex(task, downloadId), as);
                return after();
            }),
        rejectDownload: (downloadId, rejected) =>
            extensionWrite(task, () => {
                task.rejectDownloadSource(rowIndex(task, downloadId), rejected, as);
                return after();
            }),
        setOutput: ({ dir, fileName }) =>
            extensionWrite(task, () => {
                task.assertWritable(as);
                if (dir !== undefined) task.setOutputDir(dir ?? undefined);
                if (fileName !== undefined) task.setOutputFilename(fileName ?? undefined);
                return after();
            }),
        setRunFlags: ({ fetchMetadata, download }) =>
            extensionWrite(task, () => {
                task.setRunFlags({ toTag: fetchMetadata, toDownload: download }, as);
                return after();
            }),
        save: () =>
            extensionWrite(task, async () => {
                task.assertWritable(as);
                await task.saveTrack();
                return after();
            }),
        rediscover: (provider) =>
            extensionWrite(task, async () => {
                await task.rediscoverPart(provider, as);
                return after();
            }),
        redownload: () =>
            extensionWrite(task, async () => {
                await task.runDownloadPart(as);
                return after();
            }),
        separateStems: (options) =>
            extensionWrite(task, async () => {
                const { done } = await task.startStemSeparation({ ...as, model: options?.model });
                await done;
                return after();
            }),
    };
}

/** `goblin.tasks` for one extension (`label` names it in the questions it asks). */
export function createTasksApi(label: string): ExtensionTasks {
    return {
        list(filter = {}) {
            const views: TaskView[] = [];
            for (const task of orchestrator().getTasks()) {
                const view = taskView(task);
                if (view && matches(view, filter)) views.push(view);
            }
            return views;
        },
        get(id) {
            const task = orchestrator().getTask(id) ?? orchestrator().getTask(`task:${id}`);
            return task ? taskView(task) : undefined;
        },
        selected() {
            return taskSelectionBridge
                .current()
                .map((id) => orchestrator().getTask(id))
                .filter((t): t is NonNullable<typeof t> => !!t)
                .map((t) => taskView(t))
                .filter((v): v is TaskView => !!v);
        },
        onChange(listener) {
            // Once per frame however many tasks changed: never a subscription per task (CLAUDE.md, performance).
            return TaskClass.subscribeToAny(() => {
                try {
                    listener();
                } catch {
                    /* the extension's problem: its handler is its own */
                }
            });
        },
        async add(urls, options = {}) {
            const given = urls.map((u) => u.trim()).filter(Boolean);
            const resolved = await urlParserRegistry.resolveAll(given);
            const existing = new Set(
                orchestrator()
                    .getTasks()
                    .map((t) => t.getId())
            );
            const archived = getArchivedTaskIds(SessionManager.getInstance().getCurrentSession());
            const fresh: string[] = [];
            const skipped: { url: string; reason: string }[] = [];
            const seen = new Set<string>();
            resolved.forEach((url, i) => {
                const skip = (reason: string) => skipped.push({ url: given[i], reason });
                let parsed: ReturnType<typeof urlParserRegistry.parse> = null;
                try {
                    parsed = /^https?:\/\//i.test(url) ? urlParserRegistry.parse(url) : null;
                } catch {
                    /* not a link */
                }
                const id = taskIdFromUrl(url);
                if (!parsed) skip("not a link of a platform the app reads");
                else if (!["track", "album", "playlist"].includes(parsed.type))
                    skip("not a track, album or playlist link");
                else if (existing.has(id)) skip("already in the list");
                else if (archived.has(id)) skip("in the archive");
                else if (seen.has(id)) skip("given twice");
                else {
                    seen.add(id);
                    fresh.push(url);
                }
            });
            if (fresh.length === 0) return { added: [], skipped };
            const tasks = createTasksFromUrls(fresh, {
                toTag: options.fetchMetadata ?? true,
                toDownload: options.download ?? false,
            });
            importTasks(tasks);
            const ids = tasks.map((t) => t.getId());
            if (options.start) await runSelected(new Set(ids));
            return { added: ids, skipped };
        },
        async remove(ids, options = {}) {
            const o = orchestrator();
            const requested = ids.map((id) => o.getTask(id)).filter((t): t is NonNullable<typeof t> => !!t);
            // Like Delete: a busy task stays, and an album / playlist / group goes whole or not at all.
            const idle = withoutBusy(requested, (id) => o.getTask(id));
            if (idle.length === 0) return [];
            if (options.confirm !== false) {
                const names = idle.slice(0, 8).map((t) => {
                    const v = taskView(t);
                    if (!v) return t.getId();
                    return v.kind === "track"
                        ? [v.title ?? v.url, v.artists.join(", ")].filter(Boolean).join(" – ")
                        : (v.name ?? v.url);
                });
                const more = idle.length > names.length ? `\n…and ${idle.length - names.length} more` : "";
                const answer = await dialogBridge.confirm({
                    title: `Remove ${idle.length} task${idle.length === 1 ? "" : "s"}?`,
                    message:
                        `The extension "${label}" asks to remove from the list:\n` +
                        names.map((n) => `• ${n}`).join("\n") +
                        more +
                        (options.reason ? `\n\n${options.reason}` : "") +
                        "\n\nFiles already saved stay on disk.",
                    choices: [
                        { label: "Keep them", tone: "primary" },
                        { label: "Remove", tone: "danger" },
                    ],
                });
                if (answer !== 1) return [];
            }
            // Checked again: the question left time for a run to start.
            const still = withoutBusy(idle, (id) => o.getTask(id)).map((t) => t.getId());
            if (still.length > 0) o.removeTasks(still);
            return still;
        },
        async archive(ids) {
            return SessionManager.getInstance().archiveTasks(ids);
        },
        async run(ids) {
            return runSelected(new Set(ids));
        },
        async stop(ids) {
            if (!ids) return stopAll();
            for (const id of ids) orchestrator().getTask(id)?.abortRun();
        },
        edit(id) {
            return createTrackEditor(id);
        },
    };
}
