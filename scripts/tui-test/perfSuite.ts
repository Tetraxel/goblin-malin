/**
 * Runs the performance scenarios (and the micro-benchmarks) several times and stores one summary file, so a
 * change can be compared with the state before it.
 *
 *   yarn tsx scripts/tui-test/perfSuite.ts --label before
 *   ... make the change ...
 *   yarn tsx scripts/tui-test/perfSuite.ts --label after
 *   yarn tsx scripts/tui-test/perfCompare.ts before after
 *
 * Options: --runs N (default 3; the median is kept), --only a,b (scenario names), --no-bench, --no-scenarios.
 * Results go to `scripts/tui-test/profiling/results/<label>.json` (git-ignored).
 *
 * What is comparable between runs and machines: the **counts** (commits, ink frames, renders per component).
 * The milliseconds only compare runs made on the same machine, back to back.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runScenario } from "./runner.ts";
import type { Scenario } from "./types.ts";
import type { BenchResult } from "./bench/microBench.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
export const RESULTS_DIR = path.join(HERE, "profiling", "results");

/** The scenarios of the suite: the audit's scale and load cases plus the two navigation flows. */
export const SUITE_SCENARIOS = [
    "profile-navigate",
    "scroll-task-list-fast",
    "perf-idle",
    "perf-scale-500",
    "perf-scale-2000",
    "perf-load-tasks",
    "perf-load-logs",
    "perf-sessions-heavy",
    "perf-modals",
];

export interface InteractionSummary {
    label: string;
    commits: number;
    reactMs: number;
    inkFrames: number;
    inkMs: number;
    cpuMs: number;
    lagMaxMs: number;
}

export interface ScenarioSummary {
    runs: number;
    /** Time from launch to the first stable screen, in ms. */
    bootMs: number;
    totals: {
        commits: number;
        reactMs: number;
        inkFrames: number;
        inkMs: number;
        cpuMs: number;
        lagMaxMs: number;
        heapMaxMb: number;
    };
    interactions: InteractionSummary[];
    /** Render count and self time per component, for the components that rendered at least once. */
    components: Record<string, { renders: number; selfMs: number }>;
}

export interface SuiteResult {
    label: string;
    date: string;
    node: string;
    platform: string;
    runs: number;
    scenarios: Record<string, ScenarioSummary>;
    bench: BenchResult[];
}

const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
};
const round = (n: number): number => Math.round(n * 100) / 100;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadScenario(name: string): Scenario {
    const file = path.join(HERE, "examples", `${name}.json`);
    const scenario = JSON.parse(fs.readFileSync(file, "utf-8")) as Scenario;
    scenario.name = name;
    // The suite measures: never write or compare a baseline.
    scenario.profile = { enabled: true, thresholds: scenario.profile?.thresholds };
    return scenario;
}

async function runOnce(name: string): Promise<{ summary: ScenarioSummary; bootMs: number }> {
    const result = await runScenario(loadScenario(name));
    const p = result.profile;
    if (!p) throw new Error(`${name}: no profile in the result`);
    const components: ScenarioSummary["components"] = {};
    for (const c of p.components) components[c.name] = { renders: c.renders, selfMs: round(c.selfMsTotal) };
    return {
        bootMs: Number(result.metrics["stable_0_ms"] ?? 0),
        summary: {
            runs: 1,
            bootMs: Number(result.metrics["stable_0_ms"] ?? 0),
            totals: {
                commits: p.totals.commits,
                reactMs: p.totals.reactMs,
                inkFrames: p.totals.inkFrames,
                inkMs: p.totals.inkMs,
                cpuMs: p.totals.cpuMs,
                lagMaxMs: p.totals.lagMaxMs,
                heapMaxMb: p.totals.heapMaxMb,
            },
            interactions: p.interactions.map((it) => ({
                label: it.index < 0 ? "boot" : it.label,
                commits: it.commits,
                reactMs: it.reactMs,
                inkFrames: it.inkFrames,
                inkMs: it.inkMs,
                cpuMs: it.cpuMs,
                lagMaxMs: it.lagMaxMs,
            })),
            components,
        },
    };
}

/** The median of every number, run by run. Interactions are matched by position (same scenario, same steps). */
function mergeRuns(runs: ScenarioSummary[]): ScenarioSummary {
    const pick = (get: (s: ScenarioSummary) => number): number => round(median(runs.map(get)));
    const first = runs[0]!;
    const names = new Set(runs.flatMap((r) => Object.keys(r.components)));
    const components: ScenarioSummary["components"] = {};
    for (const name of names) {
        components[name] = {
            renders: round(median(runs.map((r) => r.components[name]?.renders ?? 0))),
            selfMs: round(median(runs.map((r) => r.components[name]?.selfMs ?? 0))),
        };
    }
    return {
        runs: runs.length,
        bootMs: pick((s) => s.bootMs),
        totals: {
            commits: pick((s) => s.totals.commits),
            reactMs: pick((s) => s.totals.reactMs),
            inkFrames: pick((s) => s.totals.inkFrames),
            inkMs: pick((s) => s.totals.inkMs),
            cpuMs: pick((s) => s.totals.cpuMs),
            lagMaxMs: pick((s) => s.totals.lagMaxMs),
            heapMaxMb: pick((s) => s.totals.heapMaxMb),
        },
        interactions: first.interactions.map((it, i) => {
            const at = (get: (x: InteractionSummary) => number): number =>
                round(median(runs.map((r) => (r.interactions[i] ? get(r.interactions[i]!) : 0))));
            return {
                label: it.label,
                commits: at((x) => x.commits),
                reactMs: at((x) => x.reactMs),
                inkFrames: at((x) => x.inkFrames),
                inkMs: at((x) => x.inkMs),
                cpuMs: at((x) => x.cpuMs),
                lagMaxMs: at((x) => x.lagMaxMs),
            };
        }),
        components,
    };
}

function runBench(): BenchResult[] {
    const out = spawnSync("yarn", ["-s", "tsx", "scripts/tui-test/bench/microBench.ts", "--json"], {
        cwd: ROOT,
        encoding: "utf-8",
        shell: true,
        maxBuffer: 64 * 1024 * 1024,
    });
    const line = out.stdout.trim().split("\n").pop() ?? "[]";
    try {
        return JSON.parse(line) as BenchResult[];
    } catch {
        process.stderr.write(`microBench produced no JSON:\n${out.stdout}\n${out.stderr}\n`);
        return [];
    }
}

async function main(): Promise<void> {
    const label = arg("label");
    if (!label) {
        process.stderr.write(
            "Usage: tsx scripts/tui-test/perfSuite.ts --label <name> [--runs N] [--only a,b] [--no-bench] [--no-scenarios]\n"
        );
        process.exit(1);
    }
    const runs = Number(arg("runs") ?? 3);
    const only = arg("only")?.split(",");
    const names = SUITE_SCENARIOS.filter((n) => !only || only.includes(n)).filter((n) =>
        fs.existsSync(path.join(HERE, "examples", `${n}.json`))
    );

    const result: SuiteResult = {
        label,
        date: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        runs,
        scenarios: {},
        bench: [],
    };

    if (!process.argv.includes("--no-scenarios")) {
        for (const name of names) {
            const summaries: ScenarioSummary[] = [];
            for (let i = 0; i < runs; i++) {
                process.stderr.write(`[perf] ${name} run ${i + 1}/${runs}\n`);
                try {
                    summaries.push((await runOnce(name)).summary);
                } catch (error) {
                    process.stderr.write(
                        `[perf] ${name} run ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}\n`
                    );
                }
            }
            if (summaries.length > 0) result.scenarios[name] = mergeRuns(summaries);
        }
    }
    if (!process.argv.includes("--no-bench")) {
        process.stderr.write("[perf] micro-benchmarks\n");
        result.bench = runBench();
    }

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const file = path.join(RESULTS_DIR, `${label}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    process.stdout.write(`${file}\n`);
}

// Importable by perfCompare.ts without running.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
