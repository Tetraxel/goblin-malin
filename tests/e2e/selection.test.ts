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
    // The scenario checks the highlight and the stand-in clipboard itself (it throws when a step fails); this test adds
    // what only the raw output shows: the copy also reaches the terminal, through its clipboard sequence (OSC 52).
    test("a drag is highlighted and copied on release; a click and a key remove it", async () => {
        const result = await runScenario(scenario);
        expect(result.exitCode).toBeNull();
        const { copied, block, "after-key": afterKey } = result.snapshots;

        expect(copiedBy(copied!.raw)).toEqual(["Hooked"]);
        expect(highlightedRows(copied!.ansi)).toEqual([4]);

        // Alt+drag takes the same columns of three rows; the click before it copied nothing.
        expect(copiedBy(block!.raw)).toEqual(["NOTIO\nDaft\nOppid"]);
        expect(highlightedRows(block!.ansi)).toEqual([4, 5, 6]);

        // A drag in the source list takes none of the metadata box beside it; then any key ends the selection.
        const [paneCopy, lastCopy] = copiedBy(afterKey!.raw);
        expect(paneCopy).toMatch(/^Top-ranked favorite sources/);
        expect(paneCopy).not.toMatch(/[│┌┐─]/);
        expect(lastCopy).toBe("Hooked");
        expect(highlightedRows(afterKey!.ansi)).toEqual([]);
    }, 60000);
});
