import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";

describe("smoke", () => {
    test("app starts and renders within 10s", async () => {
        const result = await runScenario({
            steps: [
                { type: "stable", timeout: 10000 },
                { type: "snapshot", name: "initial" },
            ],
        });

        expect(result.snapshots["initial"]).toBeDefined();
        expect(result.snapshots["initial"].plain.length).toBeGreaterThan(0);
        expect(result.metrics["stable_0_ms"]).toBeLessThan(10000);
        expect(result.exitCode).toBeNull();
    });
});
