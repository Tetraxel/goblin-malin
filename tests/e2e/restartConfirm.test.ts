import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";
import type { Scenario } from "../../scripts/tui-test/types.ts";

const scenarioPath = path.resolve(__dirname, "../../scripts/tui-test/examples/restart-confirm.json");
const scenario: Scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf-8"));

describe("restart (R) on a finished track", () => {
    test("asks first, and a Cancel leaves the track exactly as it was", async () => {
        const result = await runScenario(scenario);
        expect(result.exitCode).toBeNull();

        const asked = result.snapshots["asked"].plain;
        expect(asked).toContain("Restart this track?");
        expect(asked).toContain("Cancel");
        expect(asked).toContain("kept");

        // Before the dialog the row is full; after "Cancel" it is full again, with nothing rebuilt.
        for (const name of ["before", "cancelled"]) {
            const plain = result.snapshots[name].plain;
            expect(plain).toContain("NOTION");
            expect(plain).toContain("Hooked");
        }
        expect(result.snapshots["cancelled"].plain).not.toContain("Restart this track?");
    });
});
