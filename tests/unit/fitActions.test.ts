import { describe, expect, test } from "vitest";
import { fitActions, hintWidth, type HintSize } from "#components/TaskListPanel/fitActions";

// The action bar is two lines. A line wider than the panel used to be cut in the middle of a hint ("[W] D"), and the
// keys after the cut were advertised nowhere.

const hints: HintSize[] = [
    { label: "Restart", literal: "R" },
    { label: "Archive / Delete", literal: "Del" },
    { label: "Re-fetch primary metadata", literal: "F" },
    { label: "Download sources", literal: "W" },
    { label: "Toggle tagging", literal: "Enter" },
];
const total = hints.reduce((sum, h) => sum + hintWidth(h, false), 0);

/** What the line looks like, to read the tests: full `[R] Restart`, compact `[R]`, cut `…`. */
const draw = (available: number) => {
    const row = fitActions(hints, available);
    const text = row.hints.map(({ index, compact }) =>
        compact ? `[${hints[index].literal}]` : `[${hints[index].literal}] ${hints[index].label}`
    );
    if (row.more) text.push("…");
    return text.join("  ");
};
const widthOf = (available: number) => {
    const row = fitActions(hints, available);
    return (
        row.hints.reduce((sum, { index, compact }) => sum + hintWidth(hints[index], compact), 0) + (row.more ? 2 : 0)
    );
};

describe("fitActions", () => {
    test("everything is shown in full when it fits", () => {
        const row = fitActions(hints, total);
        expect(row.more).toBe(false);
        expect(row.hints.every((h) => !h.compact)).toBe(true);
        expect(row.hints).toHaveLength(hints.length);
    });

    test("when it does not fit, the first ones stay in full and the last ones are reduced to their key", () => {
        const text = draw(total - 12);
        expect(text.startsWith("[R] Restart")).toBe(true);
        expect(text).toMatch(/\[W\]/);
        expect(text).toMatch(/\[Enter\]$/);
        expect(text).not.toContain("Toggle tagging");
    });

    test("no key is lost while their keys fit", () => {
        const row = fitActions(hints, total - 12);
        expect(row.hints).toHaveLength(hints.length);
        expect(row.more).toBe(false);
    });

    test("a row too narrow even for the keys ends with …", () => {
        const text = draw(14);
        expect(text.endsWith("…")).toBe(true);
        expect(text.startsWith("[R]")).toBe(true);
    });

    test.each([0, 3, 10, 20, 40, 60, 80, total - 1, total, total + 10])(
        "never takes more room than it was given (%i columns)",
        (available) => {
            // A single hint that is wider than everything is the only thing that may not fit; none is wider here.
            if (available >= 4) expect(widthOf(available)).toBeLessThanOrEqual(available);
        }
    );

    test("nothing to show is an empty row", () => {
        expect(fitActions([], 50)).toEqual({ hints: [], more: false });
    });
});
