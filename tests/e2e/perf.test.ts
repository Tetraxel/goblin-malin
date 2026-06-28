import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";

// Component render-profiling regression guard. Unlike the screenshot smoke test,
// this asserts on machine-independent render signals: it fails only on
// `error`-severity anomalies (today: per-interaction commit cascades), which
// indicate effect loops / runaway setState rather than raw timing. ms-based
// budgets surface as `warn` and are reported but do not fail CI.
//
// No `name` is set, so this runs purely against global thresholds (no baseline
// file is read or written).
describe("render profile", () => {
    test("navigation flow has no error-severity render anomalies", async () => {
        const result = await runScenario({
            dataDir: "scripts/tui-test/fixtures/empty",
            profile: { enabled: true },
            steps: [
                { type: "stable", timeout: 10000 },
                { type: "waitForContent", text: "No task to run", timeout: 5000 },
                { type: "key", key: "ArrowRight" },
                { type: "stable" },
                { type: "key", key: "ArrowRight" },
                { type: "stable" },
                { type: "key", key: "Enter" },
                { type: "stable" },
                { type: "key", key: "Escape" },
                { type: "stable" },
            ],
        });

        const profile = result.profile;
        expect(profile).toBeDefined();
        expect(profile!.totals.commits).toBeGreaterThan(0);
        expect(profile!.components.length).toBeGreaterThan(0);

        const errors = profile!.anomalies.filter((a) => a.severity === "error");
        expect(errors, errors.map((e) => e.message).join("; ")).toHaveLength(0);
    });
});
