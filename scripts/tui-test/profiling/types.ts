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

export type ProfileRecord = CommitRecord | InkFrameRecord;

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
    inkMs: number;
    wasted: number;
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
        components: number;
        maxCommitMs: number;
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
}
