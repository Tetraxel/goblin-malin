import { AgentToolError, defineAgentTool } from "#base/agent/agentTool";
import { MAX_TASKS_TOUCHED } from "#base/agent/agentTurn";
import { type JsonSchema } from "#base/agent/jsonSchema";
import { DownloadTask } from "../../utils/downloadTask";
import { computeCompiledMetadata } from "../../utils/compiledMetadata";
import { type TrackDownloadTask } from "../../types";
import { batchPlans, cleanTitle, planOverrideChange, stalePlanTasks, type BatchItem } from "../batchPlans";
import { agentJournal, allTasks, findTask, isTaskRunning, requireDownloadTask } from "../taskAccess";
import { joinSameCall } from "../joinSameCall";
import { OVERRIDE_FIELDS } from "../../utils/overrideValidation";
import { TASK_PROBLEMS, filterTasks, type TaskFilter } from "../views";
import { overridePatchSchema, toOverridePatch } from "./writeTools";

const PREVIEW_LINES = 30;
const DIALOG_LINES = 10;
const MAX_PLAN_CHANGES = 200;

const planAnswer = (
    id: string,
    summary: string,
    items: BatchItem[],
    skipped: { taskId: string; reason: string }[]
) => ({
    planId: id,
    summary,
    tasks: items.length,
    diff: items.slice(0, PREVIEW_LINES).map((i) => ({ taskId: i.taskId, title: i.label, changes: i.diff })),
    ...(items.length > PREVIEW_LINES ? { moreTasks: items.length - PREVIEW_LINES } : {}),
    ...(skipped.length > 0 ? { skipped: skipped.slice(0, 20), skippedTotal: skipped.length } : {}),
    note: "Nothing has changed yet. Call apply_batch with this planId: the user reviews the changes first and can refuse.",
});

type PlanBatchInput = {
    summary: string;
    changes: { taskId: string; patch?: Record<string, unknown>; clear?: string[] }[];
};

export const planBatch = defineAgentTool<PlanBatchInput>({
    name: "plan_batch",
    summary:
        "Plans metadata changes for several tracks at once WITHOUT changing anything: each entry is what set_metadata_override would do. Returns a planId and the diff; apply it with apply_batch, which shows it to the user first. Use it for more than a couple of tracks.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "changes"],
        properties: {
            summary: {
                type: "string",
                minLength: 1,
                maxLength: 200,
                description: "What this batch does, in a few words.",
            },
            changes: {
                type: "array",
                minItems: 1,
                maxItems: MAX_PLAN_CHANGES,
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId"],
                    properties: {
                        taskId: { type: "string", minLength: 1, maxLength: 200 },
                        patch: overridePatchSchema,
                        clear: { type: "array", items: { type: "string", enum: [...OVERRIDE_FIELDS] }, maxItems: 10 },
                    },
                },
            },
        },
    },
    example: { summary: "Fix two titles", changes: [{ taskId: "task-1a2b3c", patch: { trackName: "Song Title" } }] },
    describeCall: (input) => `plan_batch (${input.changes.length} tasks)`,
    run: ({ summary, changes }) => {
        const items: BatchItem[] = [];
        const skipped: { taskId: string; reason: string }[] = [];
        const seen = new Set<string>();
        for (const change of changes) {
            // One wrong id (or an album) is skipped, not a reason to lose the whole plan.
            let task: DownloadTask;
            try {
                task = requireDownloadTask(change.taskId);
            } catch (error) {
                if (!(error instanceof AgentToolError)) throw error;
                skipped.push({ taskId: change.taskId, reason: error.message });
                continue;
            }
            // By the task's own id: "task:abc" and "abc" are the same task.
            if (seen.has(task.getId())) {
                skipped.push({ taskId: change.taskId, reason: "listed twice" });
                continue;
            }
            seen.add(task.getId());
            if (isTaskRunning(task)) {
                skipped.push({ taskId: change.taskId, reason: "being processed" });
                continue;
            }
            // A malformed entry (no patch, or a field both set and cleared) is skipped like a wrong id.
            let planned: ReturnType<typeof planOverrideChange>;
            try {
                planned = planOverrideChange(task, toOverridePatch(change.patch, change.clear));
            } catch (error) {
                if (!(error instanceof AgentToolError)) throw error;
                skipped.push({ taskId: change.taskId, reason: error.message });
                continue;
            }
            if (!planned) skipped.push({ taskId: change.taskId, reason: "nothing would change" });
            else if ("error" in planned) skipped.push({ taskId: change.taskId, reason: planned.error });
            else items.push(planned);
        }
        if (items.length === 0) {
            throw new AgentToolError(
                `Nothing to plan. ${skipped
                    .map((s) => `${s.taskId}: ${s.reason}`)
                    .slice(0, 5)
                    .join("; ")}`,
                "invalid"
            );
        }
        return planAnswer(batchPlans.create(summary, items).id, summary, items, skipped);
    },
});

const filterSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    description: "Which tracks to change; every given field must match.",
    properties: {
        ids: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 500 },
        query: { type: "string", maxLength: 200 },
        state: { type: "string", enum: ["pending", "running", "finished", "failed", "stopped"] },
        problem: { type: "string", enum: [...TASK_PROBLEMS] },
    },
};

type BulkInput = {
    summary?: string;
    filter: Omit<TaskFilter, "kind">;
    patch?: Record<string, unknown>;
    titleCleanup?: { removeNoise?: boolean; remove?: string[] };
};

export const planBulkOverride = defineAgentTool<BulkInput>({
    name: "plan_bulk_override",
    summary:
        "Plans the same change for every track matching a filter, worked out in code (so a 200-track job costs one call): a `patch` applied to all of them and/or a `titleCleanup` that removes video-site noise like (Official Video) or given text from each title. Changes nothing: returns a planId for apply_batch.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["filter"],
        properties: {
            summary: { type: "string", maxLength: 200 },
            filter: filterSchema,
            patch: overridePatchSchema,
            titleCleanup: {
                type: "object",
                additionalProperties: false,
                properties: {
                    removeNoise: {
                        type: "boolean",
                        description: "Remove (Official Video), [Lyrics], (HD)… from the title.",
                    },
                    remove: {
                        type: "array",
                        items: { type: "string", minLength: 1, maxLength: 60 },
                        maxItems: 10,
                        description: "Literal pieces of text to remove from the title (ignoring case).",
                    },
                },
            },
        },
    },
    example: { filter: { problem: "title_noise" }, titleCleanup: { removeNoise: true } },
    describeCall: (input) => `plan_bulk_override ${JSON.stringify(input.filter).slice(0, 60)}`,
    run: ({ summary, filter, patch, titleCleanup }) => {
        if (!patch && !titleCleanup) throw new AgentToolError("Give a patch or a titleCleanup.", "invalid");
        const tasks = filterTasks(allTasks(), { ...filter, kind: "track" }).filter(
            (t) => t instanceof DownloadTask
        ) as unknown as DownloadTask[];
        if (tasks.length === 0) throw new AgentToolError("No track matches that filter.", "invalid");
        if (tasks.length > MAX_TASKS_TOUCHED) {
            throw new AgentToolError(
                `${tasks.length} tracks match; a plan covers at most ${MAX_TASKS_TOUCHED}. Narrow the filter.`,
                "invalid"
            );
        }

        const items: BatchItem[] = [];
        const skipped: { taskId: string; reason: string }[] = [];
        for (const task of tasks) {
            if (isTaskRunning(task)) {
                skipped.push({ taskId: task.getId(), reason: "being processed" });
                continue;
            }
            const attrs = task.getAttributes() as TrackDownloadTask;
            const one: Record<string, unknown> = { ...(patch ?? {}) };
            if (titleCleanup && !("trackName" in one)) {
                const title = computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride).trackName;
                const cleaned = cleanTitle(title, titleCleanup);
                if (cleaned !== title && cleaned !== "") one.trackName = cleaned;
            }
            if (Object.keys(one).length === 0) {
                skipped.push({ taskId: task.getId(), reason: "nothing to change" });
                continue;
            }
            const planned = planOverrideChange(task, one);
            if (!planned) skipped.push({ taskId: task.getId(), reason: "nothing would change" });
            else if ("error" in planned) skipped.push({ taskId: task.getId(), reason: planned.error });
            else items.push(planned);
        }
        if (items.length === 0) throw new AgentToolError("Nothing would change for those tracks.", "invalid");
        const text = summary ?? (titleCleanup ? "Clean up titles" : "Change metadata");
        return planAnswer(batchPlans.create(text, items).id, text, items, skipped);
    },
});

export const applyBatch = defineAgentTool<{ planId: string }>({
    name: "apply_batch",
    summary:
        "Applies a plan from plan_batch / plan_bulk_override. ALWAYS shows the user the changes first (they can refuse). A plan expires if any of its tracks changed since it was made. The whole batch is one action: /undo reverts all of it.",
    kind: "confirm",
    locks: "tasks",
    undoable: true,
    leaseMs: 180_000,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["planId"],
        properties: { planId: { type: "string", minLength: 1, maxLength: 40 } },
    },
    example: { planId: "plan-1a2b3c4d" },
    describeCall: (input) => `apply_batch ${input.planId}`,
    run: ({ planId }, ctx) =>
        joinSameCall("apply_batch", ctx, [planId], async () => {
            const plan = batchPlans.get(planId);
            if (!plan)
                throw new AgentToolError(`No plan "${planId}" (it may have expired). Make a new plan.`, "not-found");
            const taskOf = (id: string): DownloadTask | undefined => {
                const t = findTask(id);
                return t instanceof DownloadTask ? (t as DownloadTask) : undefined;
            };

            const expire = (stale: { taskId: string; reason: string }[]): never => {
                batchPlans.drop(plan.id);
                throw new AgentToolError(
                    `The plan expired: ${stale.length} task(s) changed since it was made (${stale
                        .slice(0, 5)
                        .map((s) => `${s.taskId}: ${s.reason}`)
                        .join("; ")}). Read them again and make a new plan.`,
                    "stale"
                );
            };
            const staleBefore = stalePlanTasks(plan, taskOf);
            if (staleBefore.length > 0) expire(staleBefore);

            // Only the changes that are applied count, and only after the user said yes (a cancelled plan costs nothing).
            const overBudget = ctx.turn.checkBudget(plan.items.map((i) => i.taskId));
            if (overBudget) throw new AgentToolError(overBudget, "budget");

            const preview = plan.items
                .slice(0, DIALOG_LINES)
                .map((i) => `• ${i.label}\n    ${i.diff.slice(0, 2).join("\n    ")}`)
                .join("\n");
            const answer = await ctx.confirm({
                title: `Apply ${plan.items.length} change${plan.items.length === 1 ? "" : "s"} from Claude?`,
                message:
                    `${plan.summary}\n\n${preview}` +
                    (plan.items.length > DIALOG_LINES ? `\n…and ${plan.items.length - DIALOG_LINES} more` : "") +
                    "\n\nYou can undo the whole batch afterwards with /undo in the chat.",
                // The safe answer first.
                choices: [
                    { label: "Cancel", tone: "muted" },
                    { label: `Apply ${plan.items.length}`, tone: "primary" },
                ],
                accent: "#d97757",
            });
            // Stop was pressed (or the message ended) while the dialog was open: it was taken off the screen (answer null)
            // and nothing is applied. Checked first, so that is not mistaken for the user saying no.
            if (ctx.turn.isEnded || ctx.signal.aborted) {
                return {
                    applied: 0,
                    cancelled: true,
                    note: "The conversation had moved on before the answer: nothing was applied.",
                };
            }
            if (answer !== 1) {
                return {
                    applied: 0,
                    cancelled: true,
                    note: "The user did not allow it. Do not apply it again unless they ask.",
                };
            }

            // The whole set, for the length of the apply. The dialog may have waited a long time: look again.
            const got = ctx.turn.acquire(
                plan.items.map((i) => i.taskId),
                180_000
            );
            if ("ended" in got) throw new AgentToolError("The user stopped this turn: nothing was applied.", "stopped");
            if ("heldBy" in got)
                throw new AgentToolError(
                    "Some of those tasks are being edited right now. Try again in a moment.",
                    "locked"
                );
            try {
                const staleNow = stalePlanTasks(plan, taskOf);
                if (staleNow.length > 0) expire(staleNow);

                const done: BatchItem[] = [];
                const failed: { taskId: string; reason: string }[] = [];
                for (const [i, item] of plan.items.entries()) {
                    if (ctx.signal.aborted) break;
                    const task = taskOf(item.taskId)!;
                    try {
                        task.patchMetadataOverride(item.patch, { actor: "agent" });
                        done.push(item);
                    } catch (error) {
                        failed.push({ taskId: item.taskId, reason: error instanceof Error ? error.message : "failed" });
                    }
                    ctx.turn.progress(`Applying ${i + 1} of ${plan.items.length}`);
                    got.lease.renew();
                    // Let the screen repaint between items instead of freezing for a long batch.
                    if (i % 20 === 19) await new Promise((resolve) => setImmediate(resolve));
                }
                batchPlans.drop(plan.id);
                ctx.turn.count(done.map((i) => i.taskId));

                if (done.length > 0) {
                    agentJournal.record({
                        tool: "apply_batch",
                        label: `apply_batch → ${done.length} task(s): ${plan.summary}`,
                        checks: done.map((i) => ({ taskId: i.taskId, revisionAfter: taskOf(i.taskId)!.getRevision() })),
                        restore: () => {
                            for (const item of done)
                                taskOf(item.taskId)?.restoreMetadataOverride(item.before, { actor: "user" });
                        },
                    });
                }
                return {
                    applied: done.length,
                    ...(failed.length > 0 ? { failed: failed.slice(0, 20) } : {}),
                    ...(ctx.signal.aborted
                        ? { stopped: true, note: "The user pressed Stop: the rest was not applied." }
                        : {}),
                };
            } finally {
                got.lease.release();
            }
        }),
});

export const batchTools = [planBatch, planBulkOverride, applyBatch];
