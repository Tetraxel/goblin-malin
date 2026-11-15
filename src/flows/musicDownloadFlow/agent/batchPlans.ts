import { randomUUID } from "node:crypto";
import { type MetadataOverrides, type TrackDownloadTask } from "../types";
import { computeCompiledMetadata } from "../utils/compiledMetadata";
import { type DownloadTask } from "../utils/downloadTask";
import { checkOverrideChange } from "../utils/overrideValidation";
import { TITLE_NOISE_PATTERN } from "./views";
import { isTaskRunning } from "./taskAccess";

/**
 * Batches: plan → preview → apply. A plan is a dry run: it records, for each task, what would change and the
 * revision the task had, and changes nothing. `apply_batch` turns it into real changes after the user has seen it.
 * A plan expires when any of its tasks changed in between (its revision moved): the model plans again.
 */

export type BatchItem = {
    taskId: string;
    /** What the task is called, for the preview. */
    label: string;
    /** The task's revision when it was planned. */
    revision: number;
    /** What to set (a value) or take back (null), by override field. */
    patch: Record<string, unknown>;
    /** The overrides as they were, for the undo. */
    before: MetadataOverrides;
    /** One readable line per changed field. */
    diff: string[];
};

export type BatchPlan = {
    id: string;
    summary: string;
    createdAt: number;
    items: BatchItem[];
};

export const PLAN_TTL_MS = 30 * 60_000;
const MAX_PLANS = 5;

export class BatchPlanStore {
    private plans = new Map<string, BatchPlan>();

    constructor(private readonly now: () => number = Date.now) {}

    create(summary: string, items: BatchItem[]): BatchPlan {
        const plan: BatchPlan = { id: `plan-${randomUUID().slice(0, 8)}`, summary, createdAt: this.now(), items };
        this.plans.set(plan.id, plan);
        // Only the newest few: an old plan nobody applied is not worth keeping.
        while (this.plans.size > MAX_PLANS) this.plans.delete(this.plans.keys().next().value as string);
        return plan;
    }

    /** The plan, or undefined when there is none with this id or it is older than {@link PLAN_TTL_MS}. */
    get(id: string): BatchPlan | undefined {
        const plan = this.plans.get(id);
        if (!plan) return undefined;
        if (this.now() - plan.createdAt > PLAN_TTL_MS) {
            this.plans.delete(id);
            return undefined;
        }
        return plan;
    }

    drop(id: string): void {
        this.plans.delete(id);
    }

    clear(): void {
        this.plans.clear();
    }
}

export const batchPlans = new BatchPlanStore();

/** Tasks of a plan that are gone, running, or have changed since it was made. Empty = the plan still holds. */
export function stalePlanTasks(
    plan: BatchPlan,
    taskOf: (id: string) => DownloadTask | undefined
): { taskId: string; reason: string }[] {
    const stale: { taskId: string; reason: string }[] = [];
    for (const item of plan.items) {
        const task = taskOf(item.taskId);
        if (!task) stale.push({ taskId: item.taskId, reason: "the task is gone" });
        // `isTaskRunning`, not only `state`: a part run again on a finished track (run_metadata) leaves it alone.
        else if (isTaskRunning(task)) {
            stale.push({ taskId: item.taskId, reason: "the task is being processed" });
        } else if (task.getRevision() !== item.revision)
            stale.push({ taskId: item.taskId, reason: "the task changed" });
    }
    return stale;
}

const show = (value: unknown): string => {
    if (value === undefined || value === null || value === "") return "(none)";
    if (Array.isArray(value))
        return value
            .map((v) => (typeof v === "object" && v && "name" in v ? (v as { name: string }).name : String(v)))
            .join(", ");
    return String(value);
};

/**
 * Plans one task's change: validates it exactly as the panel does and works out the preview. Returns the item,
 * `undefined` when the change would change nothing, or a message when it is not acceptable.
 */
export function planOverrideChange(
    task: DownloadTask,
    patch: Record<string, unknown>
): BatchItem | { error: string } | undefined {
    const attrs = task.getAttributes() as TrackDownloadTask;
    const current = attrs.metadataOverride ?? {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key];
        else next[key] = value;
    }
    const check = checkOverrideChange(current, next);
    if (!check.ok) return { error: check.error };

    const compiledBefore = computeCompiledMetadata(attrs.metadataGroups, current);
    const compiledAfter = computeCompiledMetadata(attrs.metadataGroups, check.value);
    const diff: string[] = [];
    for (const key of Object.keys(patch)) {
        const before = show((compiledBefore as unknown as Record<string, unknown>)[key]);
        const after = show((compiledAfter as unknown as Record<string, unknown>)[key]);
        const overrideChanged =
            JSON.stringify((current as Record<string, unknown>)[key]) !==
            JSON.stringify((check.value as Record<string, unknown>)[key]);
        if (before !== after) {
            diff.push(`${key}: ${before} → ${after}${patch[key] === null ? " (override removed)" : ""}`);
        } else if (overrideChanged) {
            diff.push(`${key}: ${after} (${patch[key] === null ? "override removed" : "kept as an override"})`);
        }
    }
    if (JSON.stringify(current) === JSON.stringify(check.value)) return undefined;
    return {
        taskId: task.getId(),
        label: compiledBefore.trackName || task.getLogLabel() || task.getId(),
        revision: task.getRevision(),
        patch,
        before: { ...current },
        diff,
    };
}

// ── Title cleanup, done in code so a 200-track job does not go through the model 200 times ──────

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Removes noise from a title: the video-site tags (`removeNoise`) and any literal text of `remove`, ignoring case;
 * then tidies what is left (double spaces, a dangling " -", empty brackets). Literal text only, never a pattern
 * from the model: nothing it sends can be a runaway regular expression.
 */
export function cleanTitle(title: string, options: { removeNoise?: boolean; remove?: string[] }): string {
    let out = title;
    if (options.removeNoise) {
        const noise = new RegExp(TITLE_NOISE_PATTERN.source, "gi");
        // A pass can uncover another ("(Official Video) [HD]" is two).
        for (let i = 0; i < 5 && noise.test(out); i++) out = out.replace(noise, " ");
    }
    for (const text of options.remove ?? []) {
        if (text.trim() === "") continue;
        out = out.replace(new RegExp(escapeRegExp(text), "gi"), " ");
    }
    return out
        .replace(/\(\s*\)|\[\s*\]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, "")
        .trim();
}
