export type Step =
    | { type: "key"; key: string }
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
};

export type Snapshot = { raw: string; plain: string; ansi: string };

export type HarnessResult = {
    snapshots: Record<string, Snapshot>;
    metrics: Record<string, number | boolean>;
    exitCode: number | null;
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
    | { type: "screenshot"; name: string; path: string };

export type RunOptions = {
    onEvent?: (event: HarnessEvent) => void;
};
