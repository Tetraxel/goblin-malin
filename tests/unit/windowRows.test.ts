import { describe, test, expect } from "vitest";
import { windowRows } from "#components/SecondaryPanel/DownloadPanel/DownloadSourceDetail/windowRows";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `r${i}` }));
const keys = (list: { key: string }[]) => list.map((r) => r.key);

describe("windowRows", () => {
    test("returns everything when it fits", () => {
        expect(windowRows(rows(5), "r4", 5)).toHaveLength(5);
        expect(windowRows(rows(3), undefined, 10)).toHaveLength(3);
    });

    test("starts at the top while the cursor is near it", () => {
        expect(keys(windowRows(rows(20), "r0", 5))).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(keys(windowRows(rows(20), "r3", 5))).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    });

    test("scrolls to keep the cursor visible with one row of context below", () => {
        const view = keys(windowRows(rows(20), "r10", 5));
        expect(view).toEqual(["r7", "r8", "r9", "r10", "r11"]);
    });

    test("shows the end of the list when the cursor is on the last row", () => {
        expect(keys(windowRows(rows(20), "r19", 5))).toEqual(["r15", "r16", "r17", "r18", "r19"]);
    });

    test("an unknown focus key keeps the top", () => {
        expect(keys(windowRows(rows(20), "nope", 3))).toEqual(["r0", "r1", "r2"]);
    });

    test("counts rows taller than one", () => {
        const list = [{ key: "a", height: 2 }, { key: "b" }, { key: "c" }, { key: "d" }];
        expect(keys(windowRows(list, "a", 3))).toEqual(["a", "b"]);
        expect(keys(windowRows(list, "d", 3))).toEqual(["b", "c", "d"]);
    });

    test("a row with a focus span keeps the rows of its block in view", () => {
        const list = rows(20).map((r) => (r.key === "r10" ? { ...r, focusSpan: 4 } : r));
        // The bar at r10 and the four rows under it, not just one row of context.
        expect(keys(windowRows(list, "r10", 6))).toEqual(["r9", "r10", "r11", "r12", "r13", "r14"]);
    });

    test("a block taller than the view still shows the focused row first", () => {
        const list = rows(20).map((r) => (r.key === "r10" ? { ...r, focusSpan: 9 } : r));
        expect(keys(windowRows(list, "r10", 4))).toEqual(["r10", "r11", "r12", "r13"]);
    });
});
