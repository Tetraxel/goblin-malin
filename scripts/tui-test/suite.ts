import fs from "node:fs";
import path from "node:path";
import { parseScenario } from "./parseScenario.ts";
import { runScenario } from "./runner.ts";
import { ROOT } from "./session.ts";
import type { Scenario } from "./types.ts";

export interface SuiteOptions {
    /** Folder of scenario files (default `scripts/tui-test/examples`). */
    dir?: string;
    /** Only the scenarios whose file name contains one of these. */
    filter?: string[];
    /** Also the performance and profiling scenarios (`perf-*`, `profile-*`, or any with profiling or a `command`). */
    includePerf?: boolean;
    parallel?: number;
    updateGolden?: boolean;
    /** Keep the `screenshot*` steps (default: dropped: they open terminal windows and some need extra tools). */
    screenshots?: boolean;
    /** Per scenario (default 180 s). */
    timeoutMs?: number;
    onResult?: (result: SuiteResult) => void;
}

export interface SuiteResult {
    name: string;
    file: string;
    ok: boolean;
    skipped?: string;
    ms: number;
    /** The failure's message (the report included). */
    error?: string;
}

const DEFAULT_DIR = path.join(ROOT, "scripts", "tui-test", "examples");

/** Why a scenario is not part of the default sweep ("" when it is). */
function skipReason(name: string, scenario: Scenario): string {
    if (/^(perf|profile)-/.test(name) || scenario.profile?.enabled) return "performance scenario (--include-perf)";
    if (scenario.command) return "runs a custom command (--include-perf)";
    return "";
}

/** Runs every scenario of a folder, a few at a time, and reports one line each. */
export async function runSuite(options: SuiteOptions = {}): Promise<SuiteResult[]> {
    const dir = options.dir ?? DEFAULT_DIR;
    const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .filter((f) => !options.filter?.length || options.filter.some((part) => f.includes(part)))
        .sort();

    const results: SuiteResult[] = [];
    const queue = [...files];
    const report = (result: SuiteResult): void => {
        results.push(result);
        options.onResult?.(result);
    };

    const worker = async (): Promise<void> => {
        for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
            const name = file.replace(/\.json$/, "");
            const start = Date.now();
            try {
                const scenario = parseScenario(fs.readFileSync(path.join(dir, file), "utf-8"));
                scenario.name ??= name;
                const skipped = options.includePerf ? "" : skipReason(name, scenario);
                if (skipped) {
                    report({ name, file, ok: true, skipped, ms: 0 });
                    continue;
                }
                if (!options.screenshots)
                    scenario.steps = scenario.steps.filter((step) => !step.type.startsWith("screenshot"));
                // A synthetic load only exists in the profiled app.
                if (scenario.steps.some((step) => step.type === "startLoad")) {
                    scenario.profile = { ...(scenario.profile ?? {}), enabled: true };
                }
                await runScenario(scenario, {
                    updateGolden: options.updateGolden,
                    timeoutMs: options.timeoutMs ?? 180_000,
                });
                report({ name, file, ok: true, ms: Date.now() - start });
            } catch (error) {
                report({
                    name,
                    file,
                    ok: false,
                    ms: Date.now() - start,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, options.parallel ?? 2) }, worker));
    return results.sort((a, b) => a.file.localeCompare(b.file));
}
