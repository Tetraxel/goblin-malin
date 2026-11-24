import type { Scenario } from "./types.ts";

/**
 * The fields each step type cannot do without. `oneOf`: at least one of them (a text check takes `contains`, `matches`
 * or the older `text`; a mouse target takes a text or a cell). Kept next to the `Step` union of `types.ts`: a step
 * type missing here is reported as unknown by the unit test that loads every example.
 */
const STEP_RULES: Record<string, { required?: string[]; oneOf?: string[] }> = {
    key: { required: ["key"] },
    type: { required: ["text"] },
    paste: { required: ["text"] },
    wait: { required: ["ms"] },
    stable: {},
    waitForContent: { oneOf: ["contains", "matches", "text"] },
    waitForGone: { oneOf: ["contains", "matches", "text"] },
    assert: { oneOf: ["contains", "matches", "text"] },
    assertNot: { oneOf: ["contains", "matches", "text"] },
    assertStyle: { oneOf: ["contains", "matches", "text"] },
    snapshot: { required: ["name"] },
    assertSnapshot: { required: ["name"] },
    screenshot: { required: ["name"] },
    "screenshot-browser": { required: ["name"] },
    "screenshot-powershell": { required: ["name"] },
    resize: { required: ["cols", "rows"] },
    click: { oneOf: ["text", "matches", "col"] },
    hover: { oneOf: ["text", "matches", "col"] },
    drag: { required: ["from", "to"] },
    wheel: { required: ["direction"], oneOf: ["text", "matches", "col"] },
    pressUntil: { required: ["key"], oneOf: ["contains", "matches", "text"] },
    assertFile: { required: ["path"] },
    assertJson: { required: ["file"] },
    assertLog: {},
    assertNoErrors: {},
    assertRequest: {},
    setClipboard: { required: ["text"] },
    assertClipboard: { oneOf: ["equals", "contains", "matches", "empty"] },
    network: {},
    exit: {},
    mark: { required: ["label"] },
    startLoad: {},
    stopLoad: {},
};

export const STEP_TYPES: readonly string[] = Object.keys(STEP_RULES);

/**
 * What is wrong with a scenario's steps, one line each (empty when nothing is): an unknown step type or a missing
 * field. Checked before the app starts, so a typo fails in a moment instead of after a 20-second boot.
 */
export function validateScenario(scenario: Scenario): string[] {
    const problems: string[] = [];
    if (!Array.isArray(scenario.steps)) return ["`steps` is not a list"];
    scenario.steps.forEach((step, index) => {
        const where = `step ${index + 1}`;
        const fields = step as unknown as Record<string, unknown>;
        const type = typeof fields.type === "string" ? fields.type : undefined;
        const rules = type !== undefined ? STEP_RULES[type] : undefined;
        if (!rules) {
            problems.push(`${where}: unknown step type ${JSON.stringify(fields.type)}`);
            return;
        }
        for (const field of rules.required ?? []) {
            if (fields[field] === undefined) problems.push(`${where} (${type}): "${field}" is missing`);
        }
        if (rules.oneOf && !rules.oneOf.some((field) => fields[field] !== undefined)) {
            problems.push(`${where} (${type}): needs one of ${rules.oneOf.map((f) => `"${f}"`).join(", ")}`);
        }
    });
    return problems;
}
