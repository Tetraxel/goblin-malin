// In-process React/Ink instrumentation. Imported (for its side effects) by
// `profiledEntry.tsx` BEFORE the app — and therefore before Ink imports the
// React reconciler. Never loaded in production.
//
// How it captures per-component data without wrapping every component:
//   1. We set DEV=true so Ink calls `reconciler.injectIntoDevTools()`, which
//      wires our global hook's `onCommitFiberRoot` to fire on every commit.
//   2. `src/index.tsx` wraps the app in one <Profiler>, which forces
//      ProfileMode tree-wide so every fiber records `actualDuration`.
//   3. On each commit we walk the fiber tree and read per-fiber timing.
//
// "Did this fiber render this commit?" cannot use `actualDuration` (it is stale
// on bailed-out memoized subtrees). We use the `PerformedWork` flag — the same
// signal React DevTools uses.

import { initRecorder, isRecording, nextSeq, record, round } from "./recorder";
import type { ComponentRender, ProfileHooks } from "./types";

// Make Ink wire the reconciler into our hook (see ink.js: gated on DEV==='true').
process.env["DEV"] = "true";

initRecorder();

const PERFORMED_WORK = 0b1;

// --- Minimal fiber shape (React internals; intentionally narrow) ---
interface HookNode {
    memoizedState: unknown;
    next: HookNode | null;
}
interface FiberNode {
    tag: number;
    type: unknown;
    elementType: unknown;
    flags?: number;
    effectTag?: number;
    child: FiberNode | null;
    sibling: FiberNode | null;
    alternate: FiberNode | null;
    memoizedProps: Record<string, unknown> | null;
    memoizedState: unknown;
    actualDuration?: number;
    selfBaseDuration?: number;
}
interface FiberRoot {
    current: FiberNode;
}

function getComponentName(fiber: FiberNode): string | null {
    const type = (fiber.elementType ?? fiber.type) as unknown;
    if (type == null) return null;
    if (typeof type === "function") {
        const fn = type as { displayName?: string; name?: string };
        return fn.displayName || fn.name || "Anonymous";
    }
    if (typeof type === "object") {
        // memo(...) / forwardRef(...) wrappers carry the real component on
        // `.type` / `.render`.
        const obj = type as { displayName?: string; type?: unknown; render?: unknown };
        if (obj.displayName) return obj.displayName;
        const inner: unknown = obj.type ?? obj.render;
        if (typeof inner === "function") {
            const fn = inner as { displayName?: string; name?: string };
            return fn.displayName || fn.name || "Anonymous";
        }
    }
    // Strings are host components (ink-box/ink-text); symbols are
    // Fragment/Profiler/Context — none are user components.
    return null;
}

function didRender(fiber: FiberNode): boolean {
    if (fiber.alternate == null) return true; // mount
    const flags = fiber.flags ?? fiber.effectTag ?? 0;
    return (flags & PERFORMED_WORK) !== 0;
}

/** Changed props/state keys for a re-rendered fiber, for the "why" column. */
function diffChanges(fiber: FiberNode): string[] {
    const prev = fiber.alternate;
    if (!prev) return [];
    const changes: string[] = [];

    const a = (prev.memoizedProps ?? {}) as Record<string, unknown>;
    const b = (fiber.memoizedProps ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (key === "children") continue; // element identity churn; rarely actionable
        if (!Object.is(a[key], b[key])) changes.push(`prop:${key}`);
    }

    // Hook state lives in a linked list on memoizedState (function components).
    let cur = fiber.memoizedState as HookNode | null;
    let old = prev.memoizedState as HookNode | null;
    let i = 0;
    while (cur && old && typeof cur === "object" && "next" in cur && typeof old === "object" && "next" in old) {
        if (!Object.is(cur.memoizedState, old.memoizedState)) changes.push(`state#${i}`);
        cur = cur.next;
        old = old.next;
        i++;
    }
    return changes;
}

function onCommit(root: FiberRoot): void {
    if (!isRecording()) return;
    const t = Date.now();
    const components: ComponentRender[] = [];
    let hostNodes = 0;

    // Post-order: returns this fiber's actualDuration so the parent can derive
    // self = actual − Σ(children actual).
    function visit(fiber: FiberNode): number {
        let childSum = 0;
        let child = fiber.child;
        while (child) {
            childSum += visit(child);
            child = child.sibling;
        }

        if (typeof fiber.type === "string") hostNodes++;

        const name = getComponentName(fiber);
        const actual = fiber.actualDuration ?? 0;
        if (name && didRender(fiber)) {
            const mount = fiber.alternate == null;
            const changes = mount ? [] : diffChanges(fiber);
            components.push({
                name,
                phase: mount ? "mount" : "update",
                self: round(Math.max(0, actual - childSum)),
                actual: round(actual),
                base: round(fiber.selfBaseDuration ?? 0),
                changes: mount ? [] : changes.length ? changes : ["parent"],
            });
        }
        return actual;
    }

    const rootActual = visit(root.current);
    record({ type: "commit", seq: nextSeq(), t, durationMs: round(rootActual), hostNodes, components });
}

function installGlobalHook(): void {
    const g = globalThis as Record<string, unknown>;
    // Never clobber a real React DevTools hook if one is somehow present.
    if (g["__REACT_DEVTOOLS_GLOBAL_HOOK__"]) return;

    let rendererId = 0;
    const renderers = new Map<number, unknown>();
    const noop = (): void => {};

    g["__REACT_DEVTOOLS_GLOBAL_HOOK__"] = {
        supportsFiber: true,
        renderers,
        isDisabled: false,
        checkDCE: noop,
        inject(internals: unknown): number {
            const id = ++rendererId;
            renderers.set(id, internals);
            return id;
        },
        onCommitFiberRoot(_id: number, root: FiberRoot): void {
            try {
                onCommit(root);
            } catch {
                /* never let instrumentation crash the app */
            }
        },
        onPostCommitFiberRoot: noop,
        onCommitFiberUnmount: noop,
        onScheduleFiberRoot: noop,
        registerInternalModuleStart: noop,
        registerInternalModuleStop: noop,
        setStrictMode: noop,
        getFiberRoots: () => new Set(),
        on: noop,
        off: noop,
        sub: () => noop,
        emit: noop,
    };
}

installGlobalHook();

const hooks: ProfileHooks = {
    // The <Profiler> exists only to force ProfileMode; per-component data comes
    // from the commit walk above, so this callback does nothing.
    onProfilerRender: () => {},
    onInkRender: (info) => {
        record({ type: "ink", t: Date.now(), renderMs: round(info.renderTime) });
    },
};

globalThis.__GOBLIN_PROFILE__ = hooks;
