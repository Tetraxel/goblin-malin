// Reader-side mirror of the profiler's JSONL contract (the writer lives in
// `src/profiling/types.ts` and cannot be imported here — different tsconfig).
// Keep the record shapes in sync.

export interface ComponentRender {
    name: string;
    phase: "mount" | "update";
    self: number;
    actual: number;
    base: number;
    changes: string[];
}

export interface CommitRecord {
    type: "commit";
    seq: number;
    t: number;
    durationMs: number;
    hostNodes: number;
    components: ComponentRender[];
}

export interface InkFrameRecord {
    type: "ink";
    t: number;
    renderMs: number;
}

export interface LayoutRecord {
    type: "layout";
    t: number;
    ms: number;
}

export interface WriteRecord {
    type: "write";
    t: number;
    ms: number;
    bytes: number;
}

export interface RuntimeRecord {
    type: "runtime";
    t: number;
    cpuMs: number;
    lagMaxMs: number;
    lagP99Ms: number;
    heapMb: number;
}

export type ProfileRecord = CommitRecord | InkFrameRecord | LayoutRecord | WriteRecord | RuntimeRecord;

/** A keystroke/text step, timestamped by the runner, used to attribute commits. */
export interface InteractionMark {
    index: number;
    label: string;
    t: number;
}

// --- Thresholds (component-agnostic so new components are covered for free) ---
export interface Thresholds {
    /** Max React render time for any single commit (advisory). */
    maxCommitDurationMs: number;
    /** Max commits triggered by one interaction (cascade/effect-loop guard, hard). */
    maxCommitsPerInteraction: number;
    /** Max total React time attributed to one interaction (advisory). */
    maxInteractionReactMs: number;
    /** Max p95 self render time for any single component (advisory). */
    maxComponentSelfMsP95: number;
    /** Max parent-only ("wasted") renders in one interaction (advisory). */
    maxWastedRendersPerInteraction: number;
}

// --- Report ---
export interface ComponentStat {
    name: string;
    renders: number;
    mounts: number;
    updates: number;
    selfMsTotal: number;
    selfMsMax: number;
    selfMsP95: number;
    /** Updates where nothing but the parent changed — React.memo candidates. */
    wasted: number;
}

export interface InteractionStat {
    /** -1 = boot (everything before the first interaction). */
    index: number;
    label: string;
    commits: number;
    reactMs: number;
    inkFrames: number;
    /** Ink's `Output` stage only (see `layoutMs` and `writeMs` for the rest of a frame). */
    inkMs: number;
    /** Yoga layout, summed over the interaction's commits. */
    layoutMs: number;
    /** Time spent inside `stdout.write`. */
    writeMs: number;
    /** Bytes sent to the terminal. */
    bytes: number;
    wasted: number;
    /** Process CPU time (user + system) spent during this interaction, from the ~250 ms runtime samples. */
    cpuMs: number;
    /** Longest event-loop block seen during this interaction, in ms. */
    lagMaxMs: number;
    topComponents: { name: string; renders: number; selfMs: number }[];
}

export interface Anomaly {
    severity: "error" | "warn";
    rule: string;
    message: string;
    value: number;
    threshold: number;
    interaction?: string;
    component?: string;
}

export interface BaselineComponent {
    renders: number;
    selfMsP50: number;
    selfMsP95: number;
}

export interface Baseline {
    scenario: string;
    createdAt: string;
    totals: { commits: number; reactMs: number };
    components: Record<string, BaselineComponent>;
}

export interface BaselineComparison {
    exists: boolean;
    updated: boolean;
    regressions: Anomaly[];
    newComponents: string[];
}

export interface ProfileReport {
    scenario?: string;
    totals: {
        commits: number;
        reactMs: number;
        inkFrames: number;
        inkMs: number;
        layoutMs: number;
        writeMs: number;
        /** Bytes sent to the terminal over the whole run (boot included). */
        bytes: number;
        components: number;
        maxCommitMs: number;
        /** Process CPU time over the whole run (boot included), in ms. */
        cpuMs: number;
        /** Longest event-loop block of the whole run, in ms. */
        lagMaxMs: number;
        /** Largest heap in use, in MB. */
        heapMaxMb: number;
    };
    components: ComponentStat[];
    interactions: InteractionStat[];
    anomalies: Anomaly[];
    thresholds: Thresholds;
    baseline?: BaselineComparison;
}

/** Per-scenario profiling options (set on the Scenario or via the CLI). */
export interface ProfileConfig {
    enabled: boolean;
    thresholds?: Partial<Thresholds>;
    /** Regenerate the baseline for this scenario instead of comparing. */
    updateBaseline?: boolean;
    /**
     * Which build of React/Ink the profiled app runs. `development` (default) gives per-component render times;
     * `production` (`NODE_ENV=production`) is what users run: frame, layout, write and byte numbers stay valid,
     * per-component times and render counts are not recorded (React's profiler timer is off there).
     */
    build?: "development" | "production";
}
