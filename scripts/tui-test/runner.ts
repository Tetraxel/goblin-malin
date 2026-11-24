import { analyzeProfileFile } from "./profiling/analyze.ts";
import { TuiSession } from "./session.ts";
import { StepRunner } from "./steps.ts";
import { validateScenario } from "./validateScenario.ts";
import type { InteractionMark } from "./profiling/types.ts";
import type { FailureReport, HarnessEvent, HarnessResult, RunOptions, Scenario, Step } from "./types.ts";

/** A scenario that failed at a step: the message carries the report, `report` has the parts. */
export class ScenarioFailure extends Error {
    constructor(
        message: string,
        readonly report: FailureReport
    ) {
        super(message);
        this.name = "ScenarioFailure";
    }
}

const INPUTS_IN_REPORT = 15;
const LOG_LINES_IN_REPORT = 25;
const REQUESTS_IN_REPORT = 10;

/** Shown in the report and in the message of a failure: the step, the last inputs, the log and the requests. */
export function formatFailure(report: FailureReport, includeScreen: boolean): string {
    const parts = [`step ${report.stepIndex + 1} failed: ${JSON.stringify(report.step)}`, report.message];
    if (includeScreen) parts.push(`--- screen ---\n${report.screen || "(empty)"}`);
    if (report.inputs.length > 0) parts.push(`--- last inputs ---\n${report.inputs.join("\n")}`);
    if (report.logTail.length > 0)
        parts.push(`--- app.log (last ${report.logTail.length}) ---\n${report.logTail.join("\n")}`);
    if (report.requests.length > 0)
        parts.push(`--- network (last ${report.requests.length}) ---\n${report.requests.join("\n")}`);
    return parts.join("\n");
}

export async function buildReport(
    session: TuiSession,
    stepIndex: number,
    step: Step,
    error: unknown
): Promise<FailureReport> {
    let screen = "";
    try {
        screen = (await session.readScreen()).replace(/\s+$/, "");
    } catch {
        /* the emulator is gone: no screen */
    }
    return {
        stepIndex,
        step,
        message: error instanceof Error ? error.message : String(error),
        screen,
        inputs: session.inputs.slice(-INPUTS_IN_REPORT),
        logTail: session
            .readLog()
            .slice(-LOG_LINES_IN_REPORT)
            .map((e) => `${e.level.padEnd(5)} ${e.message.slice(0, 220)}`),
        requests: session
            .readRequests()
            .slice(-REQUESTS_IN_REPORT)
            .map((r) => `${r.outcome.padEnd(11)} ${r.method} ${r.url}`),
    };
}

export async function runScenario(scenario: Scenario, options: RunOptions = {}): Promise<HarnessResult> {
    const emit = (event: HarnessEvent) => options.onEvent?.(event);
    // A typo in a step fails now, not after the app has booted.
    const problems = validateScenario(scenario);
    if (problems.length > 0) throw new Error(`The scenario is not valid:\n  ${problems.join("\n  ")}`);

    // --- Profiling setup ---
    const profileCfg = scenario.profile?.enabled ? scenario.profile : undefined;
    const marks: InteractionMark[] = [];
    let interactionIdx = 0;
    const markInteraction = (label: string): void => {
        if (profileCfg) marks.push({ index: interactionIdx++, label, t: Date.now() });
    };

    const session = new TuiSession(scenario);
    const runner = new StepRunner(session, {
        scenario,
        emit,
        markInteraction,
        goldenDir: options.goldenDir,
        updateGolden: options.updateGolden,
    });

    const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : undefined;
    let failure: ScenarioFailure | undefined;
    try {
        for (const [index, step] of scenario.steps.entries()) {
            try {
                if (deadline && Date.now() > deadline) {
                    throw new Error(`the scenario ran longer than ${Math.round(options.timeoutMs! / 1000)}s`);
                }
                await runner.run(step);
            } catch (error) {
                const report = await buildReport(session, index, step, error);
                emit({ type: "failure", report });
                // Waits already print the screen in their message: do not show it twice.
                failure = new ScenarioFailure(
                    formatFailure(report, !report.message.includes("--- screen ---")),
                    report
                );
                break;
            }
        }
    } finally {
        await session.dispose();
    }
    if (failure) throw failure;

    const result: HarnessResult = {
        snapshots: runner.snapshots,
        metrics: runner.metrics,
        exitCode: session.appExitCode,
    };

    if (profileCfg && session.profileOut) {
        // Records are written synchronously per commit, so the file is complete
        // by the time the process is gone. Bucket commits against interaction marks.
        const report = analyzeProfileFile(session.profileOut, {
            marks,
            thresholds: profileCfg.thresholds,
            scenario: scenario.name,
            updateBaseline: profileCfg.updateBaseline,
        });
        result.profile = report;
        emit({ type: "profile", report });
    }

    return result;
}
