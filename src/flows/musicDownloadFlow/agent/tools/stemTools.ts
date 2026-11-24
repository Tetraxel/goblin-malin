import { AgentToolError, defineAgentTool, type AgentToolContext } from "#base/agent/agentTool";
import { type JsonSchema } from "#base/agent/jsonSchema";
import { taskLocks } from "#base/task/taskLock";
import { globalLogger } from "#base/logger/logger";
import { TaskLockedError, type DownloadTask } from "../../utils/downloadTask";
import { activeStemProvider, defaultStemModel, getStemEngine, resolveStemDevice } from "../../stems/stemProviders";
import { isStemRunActive } from "../../stems/stemFiles";
import { agentWrite, findTask, requireDownloadTask } from "../taskAccess";
import { runAllowance } from "../runAllowance";
import { joinSameCall } from "../joinSameCall";
import { stemsView } from "../stemsView";
import { labelOf } from "./writeTools";

const logger = globalLogger.createChild({ service: "AgentStems" });

/** How many tracks one call may separate: each takes the graphics card for a while. */
const MAX_SEPARATE_PER_CALL = 10;

const taskIdSchema: JsonSchema = { type: "string", minLength: 1, maxLength: 200 };

export const listStemModels = defineAgentTool<Record<string, never>>({
    name: "list_stem_models",
    summary:
        "Says whether stem separation is on and installed, the device it runs on, the default model, and the models that are downloaded (only those can be used). Also names the 4-stem models not downloaded yet: downloading one is the user's to do (Settings → Stems).",
    kind: "read",
    locks: "none",
    undoable: false,
    input: { type: "object", additionalProperties: false, properties: {} },
    example: {},
    describeCall: () => "list_stem_models",
    run: async () => {
        const provider = activeStemProvider();
        if (!provider)
            return { enabled: false, note: "Stem separation is off. The user turns it on in Settings → Stems." };
        const engine = getStemEngine(provider);
        const status = engine ? await engine.status() : undefined;
        if (!engine || !status?.installed) {
            return {
                enabled: true,
                installed: false,
                note: "The engine is not installed. The user installs it in Settings → Stems → Install… (several GB).",
            };
        }
        const models = await engine.listModels();
        const downloaded = models.filter((m) => m.downloaded);
        return {
            enabled: true,
            installed: true,
            version: status.version,
            device: resolveStemDevice(provider, status.build),
            defaultModel: defaultStemModel(provider),
            downloaded: downloaded.map((m) => ({
                id: m.id,
                label: m.label,
                family: m.family,
                stems: m.stems,
                sizeMB: m.sizeBytes ? Math.round(m.sizeBytes / (1024 * 1024)) : undefined,
            })),
            fourStemNotDownloaded: models
                .filter((m) => !m.downloaded && m.stems.length >= 4)
                .map((m) => ({ id: m.id, label: m.label, stems: m.stems })),
        };
    },
});

export const getStems = defineAgentTool<{ taskId: string }>({
    name: "get_stems",
    summary:
        "Reads a track's stems: each separation run (model, state, the stems it made), which run each stem uses, and the stems saved next to the track. `pick_stem` takes a runId from here.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: { type: "object", additionalProperties: false, required: ["taskId"], properties: { taskId: taskIdSchema } },
    example: { taskId: "task:1a2b3c4d5e6f" },
    describeCall: (input) => `get_stems → ${input.taskId}`,
    run: async ({ taskId }) => {
        const task = requireDownloadTask(taskId);
        const attrs = task.getAttributes();
        if (!attrs) throw new AgentToolError(`Task ${taskId} has no data`, "not-found");
        return { taskId: task.getId(), revision: task.getRevision(), ...stemsView(attrs) };
    },
});

/** Asks before separating: it takes the graphics card (or every core) for a while. The safe answer first. */
async function askToSeparate(ctx: AgentToolContext, tasks: readonly DownloadTask[], model: string): Promise<boolean> {
    if (runAllowance.stems) return true;
    const n = tasks.length;
    const answer = await ctx.confirm({
        title: `Let Claude separate ${n} ${n === 1 ? "track" : "tracks"} into stems?`,
        message:
            `Claude wants to separate ${n === 1 ? "this track" : `these ${n} tracks`} with ${model}:\n\n` +
            tasks
                .slice(0, 8)
                .map((t) => `• ${labelOf(t)}`)
                .join("\n") +
            (n > 8 ? `\n…and ${n - 8} more` : "") +
            "\n\nIt runs on this computer, one track after the other, into the app's temporary folder. Nothing is saved to your music folder by this.\n\n" +
            '"Don\'t ask again" lasts for this conversation.',
        choices: [
            { label: "Cancel", tone: "muted" },
            { label: "Separate", tone: "primary" },
            { label: "Separate, don't ask again", tone: "primary" },
        ],
        accent: "#d97757",
    });
    if (answer === 2 && !ctx.turn.isEnded && !ctx.signal.aborted) runAllowance.stems = true;
    return answer === 1 || answer === 2;
}

type SeparateInput = { taskIds: string[]; model?: string };

export const separateStems = defineAgentTool<SeparateInput>({
    name: "separate_stems",
    summary:
        "Separates tracks into stems (vocals, drums, bass, other…) on the user's computer, with a downloaded model (list_stem_models; the default one when left out). A track needs a downloaded or saved file. Always asks the user first. It queues them and answers at once: they finish in the background, one at a time. It never saves stems to the music folder.",
    kind: "confirm",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskIds"],
        properties: {
            taskIds: { type: "array", items: taskIdSchema, minItems: 1, maxItems: MAX_SEPARATE_PER_CALL },
            model: { type: "string", minLength: 1, maxLength: 200, description: "A model id from list_stem_models." },
        },
    },
    example: { taskIds: ["task:1a2b3c4d5e6f"], model: "htdemucs_ft.yaml" },
    describeCall: (input) => `separate_stems (${input.taskIds.length})`,
    // Not through `agentWrite`: it starts work on several tracks after one confirm (asked before anything starts) and
    // changes no value the user typed, so there is nothing to undo; `startStemSeparation` checks the lock itself, and
    // the budget is checked and spent here.
    run: (input, ctx) =>
        joinSameCall("separate_stems", ctx, input.taskIds, async () => {
            const provider = activeStemProvider();
            if (!provider) throw new AgentToolError("Stem separation is off (Settings → Stems).", "unavailable");
            const engine = getStemEngine(provider);
            if (!engine || !(await engine.installedBuild())) {
                throw new AgentToolError(
                    "The stem separation engine is not installed (Settings → Stems).",
                    "unavailable"
                );
            }
            const model = input.model ?? defaultStemModel(provider);
            const known = (await engine.listModels()).find((m) => m.id === model);
            if (!model || !known)
                throw new AgentToolError(`Unknown model "${model}": see list_stem_models.`, "invalid");
            if (!known.downloaded) {
                throw new AgentToolError(
                    `The model ${model} is not downloaded. Only the user can download it (Settings → Stems → Download models…).`,
                    "unavailable"
                );
            }

            const skipped: { taskId: string; reason: string }[] = [];
            const tasks: DownloadTask[] = [];
            for (const taskId of new Set(input.taskIds)) {
                const task = findTask(taskId);
                if (!task) skipped.push({ taskId, reason: "no task with this id" });
                else if (task.getAttributes()?.kind !== "track") skipped.push({ taskId, reason: "not a track" });
                else if (taskLocks.isLocked(task.getId(), "agent"))
                    skipped.push({ taskId, reason: "being edited right now" });
                else if (((task as unknown as DownloadTask).getAttributes()?.stemRuns ?? []).some(isStemRunActive))
                    skipped.push({ taskId, reason: "a separation of it is already queued or running" });
                else tasks.push(task as unknown as DownloadTask);
            }
            if (tasks.length === 0) return { started: [], skipped };
            const overBudget = ctx.turn.checkBudget(tasks.map((t) => t.getId()));
            if (overBudget) throw new AgentToolError(overBudget, "budget");
            const allowed = await askToSeparate(ctx, tasks, known.label);
            if (ctx.turn.isEnded || ctx.signal.aborted) {
                return {
                    started: [],
                    cancelled: true,
                    note: "The conversation had moved on before the answer: nothing was started.",
                };
            }
            if (!allowed) {
                return {
                    started: [],
                    cancelled: true,
                    note: "The user did not allow it. Do not ask again unless they do.",
                };
            }

            const started: { taskId: string; runId: string }[] = [];
            for (const task of tasks) {
                try {
                    const { run } = await task.startStemSeparation({ actor: "agent", model });
                    started.push({ taskId: task.getId(), runId: run.id });
                } catch (error) {
                    const reason =
                        error instanceof TaskLockedError
                            ? "the user is working on it"
                            : error instanceof Error
                              ? error.message
                              : String(error);
                    logger.info(`separate_stems skipped ${task.getId()}: ${reason}`);
                    skipped.push({ taskId: task.getId(), reason });
                }
            }
            ctx.turn.count(started.map((s) => s.taskId));
            return {
                started,
                ...(skipped.length > 0 ? { skipped } : {}),
                note: "They separate in the background, one at a time (under a minute per track on an NVIDIA card, about 10 minutes on the processor). Look with get_stems or wait_for_tasks; do not poll in a loop.",
            };
        }),
});

export const stopStems = defineAgentTool<{ taskId: string }>({
    name: "stop_stems",
    summary: "Stops the separations of a track that are queued or running. What was already separated is kept.",
    kind: "write",
    locks: "none",
    undoable: false,
    input: { type: "object", additionalProperties: false, required: ["taskId"], properties: { taskId: taskIdSchema } },
    example: { taskId: "task:1a2b3c4d5e6f" },
    describeCall: (input) => `stop_stems → ${input.taskId}`,
    // Not through `agentWrite`: a separating track is busy, which `agentWrite` refuses, and a stop is not undoable
    // (like the task's own Stop, it does not go through the write queue). The lock and the budget are still checked.
    run: async ({ taskId }, ctx) => {
        const task = requireDownloadTask(taskId);
        const running = (task.getAttributes()?.stemRuns ?? []).filter(isStemRunActive).length;
        if (running === 0) return { stopped: 0, note: "Nothing was separating." };
        const overBudget = ctx.turn.checkBudget([task.getId()]);
        if (overBudget) throw new AgentToolError(overBudget, "budget");
        try {
            task.stopStems(undefined, { actor: "agent" });
        } catch (error) {
            if (error instanceof TaskLockedError) throw new AgentToolError(error.message, "locked");
            throw error;
        }
        ctx.turn.count([task.getId()]);
        return { stopped: running };
    },
});

type PickInput = { taskId: string; kind: string; runId: string; revision: number };

export const pickStem = defineAgentTool<PickInput>({
    name: "pick_stem",
    summary:
        "Chooses which separation run's file a track uses for one stem (when several models were tried): the one the Stems view shows and that saving takes. Carries the revision you read (get_stems).",
    kind: "write",
    locks: "task",
    undoable: true,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "kind", "runId", "revision"],
        properties: {
            taskId: taskIdSchema,
            kind: { type: "string", minLength: 1, maxLength: 40 },
            runId: { type: "string", minLength: 1, maxLength: 100 },
            revision: { type: "integer", minimum: 0 },
        },
    },
    example: { taskId: "task:1a2b3c4d5e6f", kind: "vocals", runId: "0f1e2d3c-…", revision: 1234567 },
    describeCall: (input) => `pick_stem ${input.kind} → ${input.taskId}`,
    run: async (input, ctx) => {
        const task = requireDownloadTask(input.taskId);
        const kind = input.kind.trim().toLowerCase();
        return agentWrite({
            ctx,
            tool: "pick_stem",
            task,
            revision: input.revision,
            label: `pick_stem ${kind} → ${labelOf(task)}`,
            change: (as) => {
                const previous = task.getAttributes()?.stemPick;
                try {
                    task.pickStem(kind, input.runId, as);
                } catch (error) {
                    if (error instanceof TaskLockedError) throw error;
                    throw new AgentToolError(error instanceof Error ? error.message : String(error), "invalid");
                }
                return {
                    result: { taskId: task.getId(), kind, runId: input.runId },
                    restore: () => task.restoreStemPick(previous),
                };
            },
        });
    },
});

export const stemTools = [listStemModels, getStems, separateStems, stopStems, pickStem];
