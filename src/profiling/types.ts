// Shared contract between the in-process profiler (writer) and the TUI test
// harness analyzer (reader). The profiler appends one JSON object per line to
// the file named by GOBLIN_PROFILE_OUT; the harness reads it back after the run.
//
// NOTE: `scripts/tui-test/profiling/types.ts` mirrors these record shapes for
// the reader side (it cannot import from `src/` under its own tsconfig). Keep
// the two in sync.

import type { ProfilerOnRenderCallback } from "react";

/** A single component fiber that performed work in one commit. */
export interface ComponentRender {
    /** Component display name (function/class/memo/forwardRef). */
    name: string;
    phase: "mount" | "update";
    /** Self render time in ms (subtree actualDuration minus children). */
    self: number;
    /** Subtree actualDuration in ms (this fiber + descendants). */
    actual: number;
    /** selfBaseDuration in ms — cost without memoization bail-outs. */
    base: number;
    /**
     * Why it rendered: `prop:<key>`, `state#<index>`, or `parent` when it
     * re-rendered with no own prop/state change (a parent forced it).
     */
    changes: string[];
}

/** One React commit (one root render pass). */
export interface CommitRecord {
    type: "commit";
    seq: number;
    /** Date.now() epoch ms — used by the harness to bucket commits per interaction. */
    t: number;
    /** Whole-tree actualDuration in ms for this commit. */
    durationMs: number;
    /** Count of Ink host fibers (ink-box/ink-text) in the tree — a layout-size proxy. */
    hostNodes: number;
    components: ComponentRender[];
}

/** One Ink output frame (axis E: Yoga layout output + ANSI diff + write). */
export interface InkFrameRecord {
    type: "ink";
    t: number;
    /** Ink's measured output render time in ms (from its `onRender` option). */
    renderMs: number;
}

/**
 * What the process itself did during the last sampling window (~250 ms): the costs React's profiler cannot see,
 * such as a `JSON.stringify` of the sessions file or a synchronous file-system call.
 */
export interface RuntimeRecord {
    type: "runtime";
    /** End of the window, Date.now() epoch ms. */
    t: number;
    /** CPU time (user + system) used by the process during the window, in ms. */
    cpuMs: number;
    /** Longest time the event loop was blocked during the window, in ms (0 when idle). */
    lagMaxMs: number;
    /** 99th percentile of the event-loop delay during the window, in ms. */
    lagP99Ms: number;
    /** Heap in use at the end of the window, in MB. */
    heapMb: number;
}

export type ProfileRecord = CommitRecord | InkFrameRecord | RuntimeRecord;

/**
 * Callbacks the app pulls off `globalThis` in profile mode. Set by
 * `src/profiling/install.ts`; consumed by `src/index.tsx`.
 */
export interface ProfileHooks {
    /** Passed to a root `<Profiler>` purely to force ProfileMode tree-wide. */
    onProfilerRender: ProfilerOnRenderCallback;
    /** Passed to Ink's `render({ onRender })` to capture per-frame output cost. */
    onInkRender: (info: { renderTime: number }) => void;
}

declare global {
    var __GOBLIN_PROFILE__: ProfileHooks | undefined;
}
