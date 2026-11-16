import { AgentToolError, defineAgentTool } from "#base/agent/agentTool";
import { type JsonSchema } from "#base/agent/jsonSchema";
import { DownloadTask } from "../../utils/downloadTask";
import { CollectionTask } from "../../utils/collectionTask";
import { findTask } from "../taskAccess";
import { assessTask, isTaskBusy, reviewTask, type TaskOutcome } from "../runReport";
import { describeSettings, settingsSections } from "../settingsView";
import { safeText } from "../views";

const MAX_TASKS_PER_CALL = 20;

const taskIdsSchema: JsonSchema = {
    type: "array",
    items: { type: "string", minLength: 1, maxLength: 200 },
    minItems: 1,
    maxItems: MAX_TASKS_PER_CALL,
};

/** The tracks among `ids`, and the ids that are not one (with why). */
function resolveTracks(ids: readonly string[]): {
    tracks: DownloadTask[];
    skipped: { taskId: string; reason: string }[];
} {
    const tracks: DownloadTask[] = [];
    const skipped: { taskId: string; reason: string }[] = [];
    for (const taskId of new Set(ids)) {
        const task = findTask(taskId);
        if (!task) skipped.push({ taskId, reason: "no task with this id" });
        else if (task instanceof CollectionTask)
            skipped.push({ taskId, reason: "an album, playlist or group: ask about its tracks" });
        else if (task instanceof DownloadTask) tracks.push(task);
        else skipped.push({ taskId, reason: "not a track" });
    }
    return { tracks, skipped };
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done(): void {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        }
        signal.addEventListener("abort", done, { once: true });
    });

/** How often the tasks are looked at while waiting. */
const POLL_MS = 500;
const DEFAULT_WAIT_SEC = 120;
const MAX_WAIT_SEC = 240;

type WaitInput = { taskIds: string[]; timeoutSec?: number };

export const waitForTasks = defineAgentTool<WaitInput>({
    name: "wait_for_tasks",
    summary:
        "Waits until the tracks you started (run_metadata, run_download, run_task) have finished, then tells you how each one ended: its state, a verdict (ok, failed, needs_attention, stopped, not_run) with the reasons, and what was downloaded. Waits at most `timeoutSec` (default 120, up to 240); tracks still running then are listed as `stillRunning`, and you can wait again. The user can stop the wait. Waiting costs nothing: use it instead of checking again and again.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskIds"],
        properties: {
            taskIds: taskIdsSchema,
            timeoutSec: { type: "integer", minimum: 5, maximum: MAX_WAIT_SEC, description: "Default 120." },
        },
    },
    example: { taskIds: ["task:1a2b3c4d5e6f"], timeoutSec: 120 },
    describeCall: (input) => `wait_for_tasks (${input.taskIds.length})`,
    run: async ({ taskIds, timeoutSec = DEFAULT_WAIT_SEC }, ctx) => {
        const { tracks, skipped } = resolveTracks(taskIds);
        if (tracks.length === 0) return { done: true, tasks: [], skipped };

        const startedAt = Date.now();
        const deadline = startedAt + Math.min(timeoutSec, MAX_WAIT_SEC) * 1000;
        let busy = tracks.filter(isTaskBusy);
        while (busy.length > 0 && !ctx.signal.aborted && Date.now() < deadline) {
            ctx.turn.progress(`Waiting for tasks: ${tracks.length - busy.length} of ${tracks.length} done`);
            await sleep(POLL_MS, ctx.signal);
            busy = tracks.filter(isTaskBusy);
        }

        const stillRunning = new Set(busy.map((t) => t.getId()));
        const outcomes: (TaskOutcome | { taskId: string; state?: string; status: unknown; running: true })[] =
            tracks.map((task) =>
                stillRunning.has(task.getId())
                    ? {
                          taskId: task.getId(),
                          state: (task.getAttributes() as { state?: string } | undefined)?.state,
                          // Free text of the app: the user's name and folders are hidden, like everywhere else.
                          status: safeText(task.getStatus().get().message, 160) ?? "",
                          running: true as const,
                      }
                    : assessTask(task)
            );
        const finished = outcomes.filter((o): o is TaskOutcome => !("running" in o));
        const count = (v: TaskOutcome["verdict"]) => finished.filter((o) => o.verdict === v).length;
        return {
            done: stillRunning.size === 0,
            waitedSec: Math.round((Date.now() - startedAt) / 1000),
            ...(ctx.signal.aborted ? { interrupted: true } : {}),
            summary: {
                ok: count("ok"),
                failed: count("failed"),
                needs_attention: count("needs_attention"),
                stopped: count("stopped"),
                not_run: count("not_run"),
                still_running: stillRunning.size,
            },
            tasks: outcomes,
            ...(skipped.length > 0 ? { skipped } : {}),
        };
    },
});

export const reviewMetadata = defineAgentTool<{ taskIds: string[] }>({
    name: "review_metadata",
    summary:
        "Reads the metadata of several tracks at once, compact, to check it before a download: the compiled title, artists, album, year, ISRC and length, what each platform said, the MusicBrainz verdict, and `flags` for what looks off (title_noise, artists_differ, durations_differ, no_isrc, no_album, no_year, single_platform, musicbrainz_needs_review, no_title, no_artist). A track from an official Spotify link is nearly always fine; a non-official video link (an upload by a channel) is the case to check. Fix what is wrong with set_metadata_override.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskIds"],
        properties: { taskIds: taskIdsSchema },
    },
    example: { taskIds: ["task:1a2b3c4d5e6f"] },
    describeCall: (input) => `review_metadata (${input.taskIds.length})`,
    run: ({ taskIds }) => {
        const { tracks, skipped } = resolveTracks(taskIds);
        return {
            tracks: tracks.map(reviewTask),
            ...(skipped.length > 0 ? { skipped } : {}),
        };
    },
});

export const getSettings = defineAgentTool<{ section?: string }>({
    name: "get_settings",
    summary:
        "Shows the app's settings as they are now (the defaults with the user's changes): which providers are on, the output folder and format, how many downloads run at once, the MusicBrainz options, this chat's own settings… Use it to find out why something behaves oddly. Secrets (passwords, tokens, keys) are hidden, and so are the user's name and home folder. `section` limits it to one part (general, logs, metadata, download, musicBrainz, agent, collections).",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        properties: { section: { type: "string", maxLength: 40 } },
    },
    example: { section: "download" },
    describeCall: (input) => `get_settings${input.section ? ` ${input.section}` : ""}`,
    run: ({ section }) => {
        const found = describeSettings(section);
        if (!found) {
            throw new AgentToolError(
                `No settings section "${section}". The sections are: ${settingsSections().join(", ")}.`,
                "not-found"
            );
        }
        return found;
    },
});

export const reportTools = [waitForTasks, reviewMetadata, getSettings];
