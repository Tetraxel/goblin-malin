import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseScenario } from "../../scripts/tui-test/parseScenario.ts";

// DOC-01: the README's first example (`navigate-settings.json`) has `//` comments and the harness read scenarios with
// a bare `JSON.parse`, so it failed with "Unexpected token '/'". Every example must load.
const examplesDir = path.resolve(__dirname, "../../scripts/tui-test/examples");

describe("TUI harness scenarios", () => {
    test.each(fs.readdirSync(examplesDir).filter((f) => f.endsWith(".json")))("%s can be read", (file) => {
        const scenario = parseScenario(fs.readFileSync(path.join(examplesDir, file), "utf-8"));
        expect(Array.isArray(scenario.steps)).toBe(true);
        expect(scenario.steps.length).toBeGreaterThan(0);
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
