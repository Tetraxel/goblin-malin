import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";
import { parseScenario } from "../../scripts/tui-test/parseScenario.ts";

const scenarioPath = path.resolve(__dirname, "../../scripts/tui-test/examples/extensions.json");
const scenario = parseScenario(fs.readFileSync(scenarioPath, "utf-8"));

describe("an extension in the real app (P34)", () => {
    test("its Actions item and its Settings → Extensions rows are there", async () => {
        const result = await runScenario(scenario);
        expect(result.exitCode).toBeNull();
        expect(result.snapshots["menu"].plain).toContain("Remove tracks already in my library");
        const settings = result.snapshots["settings"].plain;
        expect(settings).toContain("EXTENSIONS");
        expect(settings).toContain("Library dedupe 1.0.0");
        expect(settings).toContain("Library folder");
    });

    test("an extension that leaves a rejected promise while it loads does not end the app", async () => {
        const strayPath = path.resolve(__dirname, "../../scripts/tui-test/examples/extension-stray-rejection.json");
        const result = await runScenario(parseScenario(fs.readFileSync(strayPath, "utf-8")));
        // The scenario waited for the toolbar and for the logged rejection: the process is still running.
        expect(result.exitCode).toBeNull();
    });
});
