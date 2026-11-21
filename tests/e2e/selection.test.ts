import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { runScenario } from "../../scripts/tui-test/runner.ts";
import { parseScenario } from "../../scripts/tui-test/parseScenario.ts";

const scenario = parseScenario(
    fs.readFileSync(path.resolve(__dirname, "../../scripts/tui-test/examples/select-copy.json"), "utf-8")
);

// The highlight's background, as the emulator reports it for a painted cell.
const HIGHLIGHT = "48;2;38;79;120";
const OSC52 = new RegExp(`${String.fromCharCode(27)}\\]52;c;([A-Za-z0-9+/=]*)${String.fromCharCode(7)}`, "g");
const copiedBy = (raw: string): string[] =>
    [...raw.matchAll(OSC52)].map((match) => Buffer.from(match[1]!, "base64").toString("utf8"));
const highlightedRows = (ansi: string): number[] =>
    ansi.split("\n").flatMap((line, index) => (line.includes(HIGHLIGHT) ? [index] : []));

describe("select with the mouse, copy on release", () => {
    test("a drag is highlighted and copied on release; a click and a key remove it", async () => {
        const result = await runScenario(scenario);
        expect(result.exitCode).toBeNull();
        const { before, dragging, copied, clicked, block, "after-key": afterKey } = result.snapshots;

        expect(highlightedRows(before!.ansi)).toEqual([]);
        expect(copiedBy(before!.raw)).toEqual([]);

        // While the button is down the cells are painted, and nothing is copied yet.
        expect(highlightedRows(dragging!.ansi)).toEqual([4]);
        expect(copiedBy(dragging!.raw)).toEqual([]);

        // Letting go copies exactly the text under the highlight, through the terminal's clipboard sequence.
        expect(copiedBy(copied!.raw)).toEqual(["Hooked"]);
        expect(highlightedRows(copied!.ansi)).toEqual([4]);

        // A click is only a click: the highlight goes, nothing is copied.
        expect(highlightedRows(clicked!.ansi)).toEqual([]);
        expect(copiedBy(clicked!.raw)).toEqual([]);

        // Alt+drag takes the same columns of both rows.
        expect(copiedBy(block!.raw)).toEqual(["NOTION\nDaft P"]);
        expect(highlightedRows(block!.ansi)).toEqual([4, 5]);

        // Any key ends the selection.
        expect(highlightedRows(afterKey!.ansi)).toEqual([]);
        expect(copiedBy(afterKey!.raw)).toEqual([]);
    }, 60000);
});
