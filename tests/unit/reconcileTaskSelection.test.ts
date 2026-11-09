import { describe, it, expect } from "vitest";
import { reconcileTaskSelection, type FocusState } from "../../src/hooks/useFocusManager";

const base = (over: Partial<FocusState["taskList"]> = {}): FocusState["taskList"] => ({
    selectedTaskIndex: 0,
    selectedColumnIndex: 2,
    selectedTaskIds: new Set<string>(),
    selectionAnchor: null,
    width: 80,
    isHeaderFocused: false,
    ...over,
});

describe("reconcileTaskSelection", () => {
    it("returns the same object when nothing is stale", () => {
        const tl = base({ selectedTaskIndex: 1, selectedTaskIds: new Set(["a"]) });
        expect(reconcileTaskSelection(tl, ["a", "b", "c"])).toBe(tl);
    });

    it("clamps the cursor when the last task is removed", () => {
        const tl = base({ selectedTaskIndex: 49 });
        const ids = Array.from({ length: 49 }, (_, i) => `t${i}`);
        expect(reconcileTaskSelection(tl, ids).selectedTaskIndex).toBe(48);
    });

    it("keeps index 0 when the list becomes empty", () => {
        expect(reconcileTaskSelection(base({ selectedTaskIndex: 3 }), []).selectedTaskIndex).toBe(0);
    });

    it("prunes multi-selected ids of removed tasks and drops the range anchor", () => {
        const tl = base({
            selectedTaskIds: new Set(["a", "gone"]),
            selectionAnchor: { index: 1, base: new Set() },
        });
        const out = reconcileTaskSelection(tl, ["a", "b"]);
        expect([...out.selectedTaskIds]).toEqual(["a"]);
        expect(out.selectionAnchor).toBeNull();
    });
});
