import type { ProfileConfig, ProfileReport } from "./profiling/types.ts";
import type { ScaleOptions } from "./scaleFixture.ts";

export type { ScaleOptions };

/**
 * Synthetic activity injected by the profiled app itself (`src/profiling/loadDriver.ts`), to measure what a long
 * run costs without a network or a real download: tasks changing status while a run is "in progress", and log
 * lines. Starts when the first `{ "type": "startLoad" }` step runs. Profiling must be enabled.
 */
export interface LoadConfig {
    /** How many tasks change on every tick (taken round-robin from the whole list). Default 0. */
    tasksPerTick?: number;
    /** Milliseconds between ticks. Default 250. */
    tickMs?: number;
    /** Log lines emitted on every tick. Default 0. */
    logsPerTick?: number;
    /** Level of the emitted lines. Default `debug` (what yt-dlp's stdout lines are). */
    logLevel?: "debug" | "info" | "warn";
}

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
    | { type: "screenshot-powershell"; name: string }
    /** Starts a new profiling bucket without sending a key, to measure a stretch of `wait` on its own. */
    | { type: "mark"; label: string }
    /** Starts the synthetic activity described by `scenario.load`. */
    | { type: "startLoad" }
    /** Stops it. */
    | { type: "stopLoad" };

export type Scenario = {
    terminal?: { cols?: number; rows?: number };
    /**
     * Fixture data folder (relative to project root or absolute). It is copied into a throwaway folder that
     * becomes GOBLIN_DATA_DIR, so a run never modifies the fixture. Defaults to `fixtures/empty`.
     */
    dataDir?: string;
    /** Grows the copy of the fixture before the app starts (see `scaleFixture.ts`). */
    scale?: ScaleOptions;
    /** Deep-merged into the copy's `settings.json` (e.g. `{ "logs": { "logLevel": "INFO" } }`), whatever the fixture says. */
    settings?: Record<string, unknown>;
    /** Shell command that starts the app, instead of `yarn dev` / the profiled entry. */
    command?: string;
    /** Synthetic activity for `startLoad` steps. */
    load?: LoadConfig;
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
