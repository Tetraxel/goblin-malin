import type { ProfileConfig, ProfileReport } from "./profiling/types.ts";

export type Step =
    | { type: "key"; key: string; delayMs?: number; repeat?: number }
    | { type: "type"; text: string }
    | { type: "wait"; ms: number }
    | { type: "stable"; timeout?: number; quiescenceMs?: number; minBytes?: number }
    | { type: "waitForContent"; text: string; timeout?: number }
    | { type: "assert"; contains: string }
    | { type: "snapshot"; name: string }
    | { type: "screenshot"; name: string }
    | { type: "screenshot-browser"; name: string }
    | { type: "screenshot-powershell"; name: string };

export type Scenario = {
    terminal?: { cols?: number; rows?: number };
    /** Path to the data directory for the app (relative to project root or absolute). Sets GOBLIN_DATA_DIR. */
    dataDir?: string;
    steps: Step[];
    env?: Record<string, string>;
    /** Stable name used to key the profiling baseline. Defaults to the scenario filename. */
    name?: string;
    /** Per-component render profiling. Enable in JSON or via the CLI `--profile` flag. */
    profile?: ProfileConfig;
};

export type Snapshot = { raw: string; plain: string; ansi: string };

export type HarnessResult = {
    snapshots: Record<string, Snapshot>;
    metrics: Record<string, number | boolean>;
    exitCode: number | null;
    /** Present only when the scenario ran with profiling enabled. */
    profile?: ProfileReport;
};

export type HarnessEvent =
    | { type: "key"; key: string }
    | { type: "type"; text: string }
    | { type: "wait"; ms: number }
    | { type: "stable:start" }
    | { type: "stable:end"; ms: number; timedOut: boolean }
    | { type: "waitForContent:start"; text: string }
    | { type: "waitForContent:end"; text: string; ms: number; found: boolean }
    | { type: "assert:pass"; contains: string }
    | { type: "snapshot"; name: string; plain: string; ansi: string }
    | { type: "screenshot"; name: string; path: string }
    | { type: "profile"; report: ProfileReport };

export type RunOptions = {
    onEvent?: (event: HarnessEvent) => void;
};
