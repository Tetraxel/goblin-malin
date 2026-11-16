import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";
import type { Scenario } from "../../scripts/tui-test/types.ts";

const scenarioPath = path.resolve(__dirname, "../../scripts/tui-test/examples/group-tasks.json");
const scenario: Scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf-8"));

describe("groups (Ctrl+G)", () => {
    test("groups the selected tracks, names the group, renames it, folds it and dissolves it", async () => {
        const result = await runScenario(scenario);
        expect(result.exitCode).toBeNull();

        // Ctrl+G is offered on a track, and on three selected tracks it asks for a name that starts as "Group 1".
        expect(result.snapshots["single-selected"].plain).toContain("Group");
        expect(result.snapshots["three-selected"].plain).toContain("3 selected tasks");
        expect(result.snapshots["name-dialog"].plain).toContain("Name this group");
        expect(result.snapshots["name-dialog"].plain).toContain("Group 1");

        // The group row carries the name typed, the count, and its three tracks sit under it.
        const grouped = result.snapshots["grouped"].plain;
        expect(grouped).toContain("[GROUP] Road trip");
        expect(grouped).toContain("3 tracks");
        expect(grouped).toContain("Ungroup");
        expect(grouped.match(/↳ SPOTIFY/g)).toHaveLength(3);

        // Enter on the name opens the rename dialog; Esc leaves the name alone.
        expect(result.snapshots["rename-cancelled"].plain).toContain("[GROUP] Road trip");

        // Folding hides the three tracks.
        expect(result.snapshots["collapsed"].plain).toContain("Expand");
        expect(result.snapshots["collapsed"].plain).not.toContain("↳ SPOTIFY");

        // Ungrouping keeps the tracks and drops the group.
        expect(result.snapshots["ungrouped"].plain).not.toContain("[GROUP]");
        expect(result.snapshots["ungrouped"].plain).toContain("Task 1/50");
    });
});
