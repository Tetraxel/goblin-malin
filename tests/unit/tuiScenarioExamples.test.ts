import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseScenario } from "../../scripts/tui-test/parseScenario.ts";
import { validateScenario } from "../../scripts/tui-test/validateScenario.ts";

// DOC-01: the README's first example (`navigate-settings.json`) has `//` comments and the harness read scenarios with
// a bare `JSON.parse`, so it failed with "Unexpected token '/'". Every example must load.
const examplesDir = path.resolve(__dirname, "../../scripts/tui-test/examples");

describe("TUI harness scenarios", () => {
    test.each(fs.readdirSync(examplesDir).filter((f) => f.endsWith(".json")))("%s can be read", (file) => {
        const scenario = parseScenario(fs.readFileSync(path.join(examplesDir, file), "utf-8"));
        expect(Array.isArray(scenario.steps)).toBe(true);
        expect(scenario.steps.length).toBeGreaterThan(0);
        // Every step is of a known type and has the fields it needs (a typo would only fail once the app had booted).
        expect(validateScenario(scenario)).toEqual([]);
    });

    test("a typo in a step or a missing field is reported before the app starts", () => {
        const problems = validateScenario({
            steps: [
                { type: "asert", contains: "x" },
                { type: "waitForContent", timeout: 3 },
                { type: "key" },
                { type: "assertClipboard", equals: "" },
            ],
        } as never);
        expect(problems).toEqual([
            'step 1: unknown step type "asert"',
            'step 2 (waitForContent): needs one of "contains", "matches", "text"',
            'step 3 (key): "key" is missing',
        ]);
    });

    test("a // comment runs to the end of the line, and a // inside a string is text", () => {
        const scenario = parseScenario(
            `{
                // a comment
                "steps": [
                    { "type": "paste", "text": "https://example.test/a" }, // trailing
                    { "type": "paste", "text": "say \\"//\\" here" }
                ]
            }`
        );
        expect(scenario.steps).toEqual([
            { type: "paste", text: "https://example.test/a" },
            { type: "paste", text: 'say "//" here' },
        ]);
    });
});
