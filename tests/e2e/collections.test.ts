import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";
import type { Scenario } from "../../scripts/tui-test/types.ts";

const scenarioPath = path.resolve(__dirname, "../../scripts/tui-test/examples/collection-import.json");
const scenario: Scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf-8"));

describe("collections (P21)", () => {
    test("renders un-expanded album/playlist parents, collapses/expands, and toggles live refresh", async () => {
        const result = await runScenario(scenario);

        expect(result.exitCode).toBeNull();
        expect(result.snapshots["initial"].plain).toContain("[PLAYLIST]");
        expect(result.snapshots["initial"].plain).toContain("[ALBUM]");
        // The album is collapsed in the fixture — its child rows must not render.
        expect(result.snapshots["initial"].plain).not.toContain("ALBUMTRK");

        expect(result.snapshots["playlist-selected"].plain).toContain("Collapse");
        expect(result.snapshots["playlist-collapsed"].plain).toContain("Expand");
        // Collapsing the playlist hides its own children too.
        expect(result.snapshots["playlist-collapsed"].plain).not.toContain("TRACKA");
        expect(result.snapshots["playlist-expanded-again"].plain).toContain("TRACKA");
        expect(result.snapshots["live-disabled"].plain).toContain("Enable live refresh");
    });
});
