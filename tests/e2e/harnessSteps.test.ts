import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { runScenario, ScenarioFailure } from "../../scripts/tui-test/runner.ts";
import { parseScenario } from "../../scripts/tui-test/parseScenario.ts";
import type { Scenario } from "../../scripts/tui-test/types.ts";

const examples = path.resolve(__dirname, "../../scripts/tui-test/examples");
const load = (name: string): Scenario => {
    const scenario = parseScenario(fs.readFileSync(path.join(examples, `${name}.json`), "utf-8"));
    scenario.name = name;
    return scenario;
};

describe("tui harness steps", () => {
    test("text, style, golden snapshot, mouse, resize, log and exit steps", async () => {
        const result = await runScenario(load("harness-features"));
        // The `exit` step saw the app close by itself.
        expect(result.exitCode).toBe(0);
    });

    test("the fake network answers the app and records its requests", async () => {
        const result = await runScenario(load("fake-network"));
        expect(result.snapshots["fetched"]?.plain).toContain("Daft Punk");
    });

    test("user data survives a run that fails", async () => {
        await runScenario(load("user-data-survives-failed-run"));
    });

    test("a failing step reports the step, the screen, the inputs and the log", async () => {
        const failure = await runScenario({
            terminal: { cols: 100, rows: 30 },
            steps: [
                { type: "stable", timeout: 20000 },
                { type: "key", key: "Down" },
                { type: "assertNot", contains: "Goblin Malin" },
            ],
        }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ScenarioFailure);
        const report = (failure as ScenarioFailure).report;
        expect(report.stepIndex).toBe(2);
        expect(report.message).toContain("assertNot failed");
        expect(report.screen).toContain("Goblin Malin");
        expect(report.inputs).toContain("Down");
        expect((failure as ScenarioFailure).message).toContain("--- last inputs ---");
    });
});
