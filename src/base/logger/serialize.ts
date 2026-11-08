/**
 * What goes into `app.log`. The in-memory log panel keeps the live objects (it needs the real `Task` to
 * filter by it); the file gets this plain-data form instead:
 *
 * - a `Task` becomes `{ taskId, label }` — it used to be stringified whole (attributes, caches, abort
 *   maps…), 2–30 KB per line, synchronously on the UI thread;
 * - an `Error` becomes `{ name, message, stack, cause }` — `JSON.stringify(new Error("x"))` is `{}`, so
 *   the reason of every `logger.warn("…", { error })` was lost;
 * - cycles and very deep objects are cut instead of throwing.
 */

const MAX_DEPTH = 6;

export interface TaskRef {
    taskId: string;
    label?: string;
}

/** Duck-typed on purpose: importing `Task` here would pull the whole task graph into the logger. */
function isTaskLike(value: object): value is { id: string; getLogLabel?: () => string | undefined } {
    const candidate = value as { id?: unknown; getAttributes?: unknown };
    return typeof candidate.id === "string" && typeof candidate.getAttributes === "function";
}

export function toTaskRef(task: { id: string; getLogLabel?: () => string | undefined }): TaskRef {
    let label: string | undefined;
    try {
        label = task.getLogLabel?.();
    } catch {
        // a label is a nicety; never let it break logging
    }
    return label ? { taskId: task.id, label } : { taskId: task.id };
}

export function toLoggable(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null || typeof value !== "object") {
        if (typeof value === "bigint") return value.toString();
        if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
        if (typeof value === "symbol") return value.toString();
        return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (isTaskLike(value)) return toTaskRef(value);
    if (seen.has(value)) return "[Circular]";
    if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[Array]" : "[Object]";
    seen.add(value);

    try {
        if (value instanceof Error) {
            const out: Record<string, unknown> = { name: value.name, message: value.message, stack: value.stack };
            if (value.cause !== undefined) out.cause = toLoggable(value.cause, depth + 1, seen);
            // Extra own fields (`code`, `status`, an AggregateError's `errors`…) are often the useful part.
            for (const key of Object.keys(value)) {
                out[key] = toLoggable((value as unknown as Record<string, unknown>)[key], depth + 1, seen);
            }
            return out;
        }
        if (value instanceof Map) return toLoggable(Object.fromEntries(value), depth, seen);
        if (value instanceof Set) return toLoggable([...value], depth, seen);
        if (Array.isArray(value)) return value.map((item) => toLoggable(item, depth + 1, seen));

        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = toLoggable(item, depth + 1, seen);
        }
        return out;
    } finally {
        // Only an ancestor chain is a cycle; the same object appearing twice side by side is fine.
        seen.delete(value);
    }
}
