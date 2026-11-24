import type { ProfileConfig, ProfileReport } from "./profiling/types.ts";
import type { ScaleOptions } from "./scaleFixture.ts";
import type { Region, StyleSpec, TextMatch } from "./matchers.ts";
import type { JsonExpectation } from "./jsonPath.ts";
import type { MouseButton, MouseModifiers } from "./mouse.ts";

export type { ScaleOptions, Region, StyleSpec, TextMatch, JsonExpectation };

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
    /** Words "streamed" into the chat with Claude on every tick, as if an answer were being written. Default 0. */
    chatWordsPerTick?: number;
}

/** Where a mouse step acts: a cell (1-based) or the first (or n-th) place some text is on the screen. */
export type MouseTarget =
    | { col: number; row: number }
    | {
          text: string;
          occurrence?: number;
          /** Columns right of the text's first cell (default: its middle). */
          offset?: number;
      }
    | { matches: string; flags?: string; occurrence?: number; offset?: number };

export type MouseOptions = MouseModifiers & { button?: MouseButton };

/** One answer of the fake network. See `preload/fakeNetwork.mjs`. */
export interface NetworkRule {
    /** The rule applies to a request whose URL contains this text… */
    url?: string;
    /** …or matches this regular expression. A rule with neither applies to every request. */
    matches?: string;
    /** Only this HTTP method (default: any). */
    method?: string;
    /** Answer's status (default 200). */
    status?: number;
    /** Answer's body as JSON, as text, or from a file (relative to the repository root). */
    json?: unknown;
    body?: string;
    bodyFile?: string;
    headers?: Record<string, string>;
    /** Wait this long before answering (cut short by the request's own abort signal). */
    delayMs?: number;
    /** Fail like a broken connection, with this message, instead of answering. */
    error?: string;
    /** The rule answers this many requests, then stops applying (default: always). */
    times?: number;
}

export interface NetworkConfig {
    /** What an unmatched request gets: `offline` fails like a missing connection (default), `passthrough` goes out. */
    mode?: "offline" | "passthrough";
    rules?: NetworkRule[];
}

/** Which log lines a log assertion looks at. */
export interface LogMatch {
    contains?: string;
    matches?: string;
    level?: "debug" | "info" | "warn" | "error";
}

export type Step =
    | { type: "key"; key: string; delayMs?: number; repeat?: number }
    /** Writes text in one chunk (like a paste), then waits `delayMs` (default 100) so a following key arrives apart. */
    | { type: "type"; text: string; delayMs?: number }
    /** Pastes text in one write (`bracketed`: wrapped in the bracketed-paste markers), then waits like `type`. */
    | { type: "paste"; text: string; bracketed?: boolean; delayMs?: number }
    | { type: "wait"; ms: number }
    | { type: "stable"; timeout?: number; quiescenceMs?: number; minBytes?: number }
    | ({ type: "waitForContent"; text?: string; timeout?: number } & TextMatch)
    | ({ type: "waitForGone"; text?: string; timeout?: number } & TextMatch)
    | ({ type: "assert"; count?: number; min?: number; max?: number; text?: string } & TextMatch)
    | ({ type: "assertNot"; text?: string } & TextMatch)
    | ({
          type: "assertStyle";
          /** The first (or n-th) place the text is on the screen: every one of its cells must have the style. */
          occurrence?: number;
          text?: string;
      } & TextMatch &
          StyleSpec)
    | { type: "snapshot"; name: string; region?: Region }
    /** Compares the screen with the golden file `golden/<scenario>/<name>.txt` (written by `--update-golden`). */
    | { type: "assertSnapshot"; name: string; region?: Region; mask?: string[]; timeout?: number }
    | { type: "screenshot"; name: string }
    | { type: "screenshot-browser"; name: string }
    | { type: "screenshot-powershell"; name: string }
    /** Resizes the terminal: the app is told like it is when the user drags the window's edge. */
    | { type: "resize"; cols: number; rows: number }
    | ({ type: "click"; double?: boolean } & MouseTarget & MouseOptions)
    | {
          type: "drag";
          from: MouseTarget;
          to: MouseTarget;
          /** Motion events between press and release (default: one per cell, at most 40). */
          steps?: number;
          /** Leave the button down (no release), to look at the highlight while dragging. */
          hold?: boolean;
          button?: MouseButton;
          shift?: boolean;
          alt?: boolean;
          ctrl?: boolean;
      }
    /** Moves the pointer over a cell with no button down (hover). */
    | ({ type: "hover" } & MouseTarget & MouseModifiers)
    | ({ type: "wheel"; direction: "up" | "down"; count?: number } & MouseTarget & MouseModifiers)
    /** Presses a key until the text shows up (at most `max` times): no counting of arrow presses in the scenario. */
    | ({ type: "pressUntil"; key: string; max?: number; delayMs?: number; text?: string } & TextMatch)
    /** A file of the app's data folder (path relative to it; `output/` and `tmp/` are inside it). */
    | { type: "assertFile"; path: string; exists?: boolean; contains?: string; matches?: string; timeout?: number }
    /** A value inside a JSON file of the data folder (`settings.json`, `sessions.json`), by path. */
    | ({ type: "assertJson"; file: string; path?: string; timeout?: number } & JsonExpectation)
    /** Lines of `app.log` (at least one, or exactly `count`). */
    | ({ type: "assertLog"; count?: number; min?: number; max?: number; timeout?: number } & LogMatch)
    /** No `error` line in the log (except those matching `ignore`). */
    | { type: "assertNoErrors"; ignore?: string[]; level?: "warn" | "error" }
    /** Requests the app made through the fake network. */
    | {
          type: "assertRequest";
          url?: string;
          matches?: string;
          method?: string;
          count?: number;
          min?: number;
          max?: number;
          timeout?: number;
      }
    /** Puts text on the (stand-in) clipboard, for what the app reads from it: `Ctrl+V`, "paste link"… */
    | { type: "setClipboard"; text: string }
    /** What the app last copied (waits up to `timeout`, default 3 s): `equals`, `contains`, `matches`, or `empty`. */
    | {
          type: "assertClipboard";
          equals?: string;
          contains?: string;
          matches?: string;
          empty?: boolean;
          timeout?: number;
      }
    /** Changes the fake network while the app runs (`append`: add rules after the current ones). */
    | ({ type: "network"; append?: boolean } & NetworkConfig)
    /** Waits for the app to exit (optionally after pressing a key) and checks its exit code. */
    | { type: "exit"; key?: string; timeout?: number; code?: number }
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
    /**
     * What is on the clipboard when the app starts. The app never reads nor writes the real one in a scenario: a file
     * stands in for it (`GOBLIN_TEST_CLIPBOARD`); `setClipboard` / `assertClipboard` steps change and check it.
     */
    clipboard?: string;
    /** Fake network (see `preload/fakeNetwork.mjs`): without it the app talks to the real internet. */
    network?: NetworkConfig;
    steps: Step[];
    env?: Record<string, string>;
    /** Stable name used to key the profiling baseline and the golden folder. Defaults to the scenario filename. */
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
    /** `contains` describes what was checked (the text, the regular expression…). */
    | { type: "assert:pass"; contains: string }
    /** A step with no event of its own (click, resize, assertFile…): its name and a one-line detail. */
    | { type: "step"; step: string; detail: string }
    | { type: "snapshot"; name: string; plain: string; ansi: string }
    | { type: "screenshot"; name: string; path: string }
    | { type: "failure"; report: FailureReport }
    | { type: "profile"; report: ProfileReport };

/** What is known when a step fails, so a failure on CI (where nobody watched) can be read. */
export type FailureReport = {
    stepIndex: number;
    step: Step;
    message: string;
    screen: string;
    /** The last keys and text sent to the app, oldest first. */
    inputs: string[];
    /** The last lines of `app.log`, formatted `level message`. */
    logTail: string[];
    /** The last requests of the fake network, when there is one. */
    requests: string[];
};

export type RunOptions = {
    onEvent?: (event: HarnessEvent) => void;
    /** Where `assertSnapshot` reads and writes golden files (default `scripts/tui-test/golden/<scenario name>`). */
    goldenDir?: string;
    /** Writes the golden files instead of comparing with them. */
    updateGolden?: boolean;
    /** The scenario fails between two steps once it has run this long. */
    timeoutMs?: number;
};
