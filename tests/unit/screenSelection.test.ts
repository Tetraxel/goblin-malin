import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MouseEvent } from "#base/mouse/mouse";
import { osc52Sequence } from "#base/selection/clipboardWrite";
import {
    clampPoint,
    highlightRow,
    isPaneEdge,
    paneBounds,
    rowSpan,
    selectedText,
    type Selection,
} from "#base/selection/selection";
import { getScreenTap, type ScreenCell, type ScreenRow } from "#base/selection/screenTap";

const cell = (value: string, styles: ScreenCell["styles"] = []): ScreenCell => ({
    type: "char",
    value,
    fullWidth: false,
    styles,
});

/** A screen row from a string; a wide character (CJK) is followed by its empty continuation cell. */
function row(text: string): ScreenRow {
    const cells: ScreenCell[] = [];
    for (const ch of text) {
        cells.push(cell(ch));
        if (/[぀-ヿ一-鿿]/u.test(ch)) cells.push(cell(""));
    }
    return cells;
}

const screen = (...rows: string[]): ScreenRow[] => rows.map(row);

const sel = (
    anchor: [number, number],
    focus: [number, number],
    extra: Partial<Selection> = {},
    width = 40
): Selection => ({
    anchor: { x: anchor[0], y: anchor[1] },
    focus: { x: focus[0], y: focus[1] },
    block: false,
    bounds: { left: 0, right: width },
    ...extra,
});

describe("selectedText", () => {
    const frame = screen(
        "Artist  Title      Time ",
        "Daft    Technologic 5:28",
        "Oppidan Armed       3:12",
        "                        "
    );

    test("one row: the cells from the anchor to the focus, both included", () => {
        expect(selectedText(frame, sel([8, 1], [18, 1]))).toBe("Technologic");
    });

    test("it does not matter which way the drag went", () => {
        expect(selectedText(frame, sel([18, 1], [8, 1]))).toBe("Technologic");
        expect(selectedText(frame, sel([4, 2], [4, 0]))).toBe(selectedText(frame, sel([4, 0], [4, 2])));
    });

    test("several rows flow like a terminal's: the rest of the first, whole rows, the start of the last", () => {
        expect(selectedText(frame, sel([8, 0], [6, 2]))).toBe(
            ["Title      Time", "Daft    Technologic 5:28", "Oppidan"].join("\n")
        );
    });

    test("a block takes the same columns of every row", () => {
        expect(selectedText(frame, sel([8, 0], [18, 2], { block: true }))).toBe(
            ["Title", "Technologic", "Armed"].join("\n")
        );
    });

    test("the blanks at the end of a row and empty lines at either end are cut", () => {
        expect(selectedText(frame, sel([0, 2], [30, 3]))).toBe("Oppidan Armed       3:12");
    });

    test("the padding between a panel's border and its text is not copied, the text's own indentation is", () => {
        const padded = screen("  title", "    child one", "    child two", "  other");
        expect(selectedText(padded, sel([0, 0], [11, 3]))).toBe("title\n  child one\n  child two\nother");
        // The first row of a flowing selection starts mid-text: it takes no part in it.
        expect(selectedText(padded, sel([4, 0], [11, 3]))).toBe("tle\n  child one\n  child two\nother");
    });

    test("an empty line in the middle stays", () => {
        const text = selectedText(screen("one", "", "two"), sel([0, 0], [2, 2]));
        expect(text).toBe("one\n\ntwo");
    });

    test("a row that is only a border line is not text", () => {
        const text = selectedText(screen("top", "├──────┤", "bottom"), sel([0, 0], [5, 2]));
        expect(text).toBe("top\nbottom");
    });

    test("a panel's border row is dropped even when only the columns inside its corners are selected", () => {
        const frame = screen("│ top    │", "├────────┤", "│ bottom │");
        const bounds = { left: 1, right: 9 };
        expect(selectedText(frame, sel([1, 0], [8, 2], { bounds }))).toBe("top\nbottom");
    });

    test("a bar made of box-drawing characters is text, not a border", () => {
        expect(selectedText(screen("progress", "━━━━━━━━━━"), sel([0, 0], [9, 1]))).toBe("progress\n━━━━━━━━━━");
        expect(selectedText(screen("━━━━━━━━━━"), sel([0, 0], [9, 0]))).toBe("━━━━━━━━━━");
        // Between a panel's edges too: the edges are lines, not corners.
        const frame = screen("│ a ━━━ │", "│ ━━━━━ │", "│ b     │");
        expect(selectedText(frame, sel([1, 1], [7, 1], { bounds: { left: 1, right: 8 } }))).toBe("━━━━━");
    });

    test("a selection past the end of the screen is cut to it", () => {
        expect(selectedText(frame, sel([0, 2], [10, 99]))).toBe("Oppidan Armed       3:12");
    });

    test("a wide character is taken whole, from either of its cells", () => {
        const wide = screen("a日本語b");
        // cells: a 日 '' 本 '' 語 '' b  (columns 1-2 are 日)
        expect(selectedText(wide, sel([2, 0], [3, 0]))).toBe("日本");
        expect(selectedText(wide, sel([1, 0], [1, 0]))).toBe("日");
        expect(selectedText(wide, sel([0, 0], [7, 0]))).toBe("a日本語b");
    });

    test("cells Ink never wrote count as blanks", () => {
        const holes: ScreenRow[] = [[cell("a"), undefined, cell("b")]];
        expect(selectedText(holes, sel([0, 0], [2, 0]))).toBe("a b");
    });
});

describe("the pane around a press", () => {
    const frame = screen(
        "┌────────────┬─────┐",
        "│ list one   │ box │",
        "│ list two   │ box │",
        "└────────────┴─────┘"
    );
    const edge = frame[1]!.findIndex((c, i) => i > 0 && c?.value === "│");

    test("a press between two vertical lines stays between them", () => {
        expect(paneBounds(frame, 3, 1)).toEqual({ left: 1, right: edge });
        expect(paneBounds(frame, edge + 2, 2)).toEqual({ left: edge + 1, right: frame[2]!.length - 1 });
    });

    test("with no line on a side, the screen's edge is the limit", () => {
        expect(paneBounds(screen("plain text here"), 4, 0)).toEqual({ left: 0, right: 15 });
        const left = screen("┌────", "│ left only   ", "└────");
        expect(paneBounds(left, 5, 1)).toEqual({ left: 1, right: 14 });
    });

    test("a vertical-line glyph that is part of a text is not an edge", () => {
        const text = screen("some │ text │ here", "other text");
        expect(isPaneEdge(text, 5, 0)).toBe(false);
        expect(paneBounds(text, 8, 0)).toEqual({ left: 0, right: 18 });
        // ...but one that goes on above or below is.
        expect(isPaneEdge(frame, edge, 1)).toBe(true);
        expect(isPaneEdge(frame, edge, 0)).toBe(false); // a "┬" is not a vertical line
    });

    test("a drag never leaves the pane, and never leaves the screen", () => {
        const bounds = { left: 1, right: 12 };
        expect(clampPoint({ x: 30, y: 2 }, bounds, 5)).toEqual({ x: 11, y: 2 });
        expect(clampPoint({ x: -4, y: -1 }, bounds, 5)).toEqual({ x: 1, y: 0 });
        expect(clampPoint({ x: 5, y: 80 }, bounds, 5)).toEqual({ x: 5, y: 4 });
    });

    test("the other pane's text is not taken along", () => {
        const frame = screen("│ one        │ AAAA │", "│ two        │ BBBB │", "│ three      │ CCCC │");
        const bounds = paneBounds(frame, 3, 0);
        expect(selectedText(frame, sel([2, 0], [11, 2], { bounds }))).toBe("one\ntwo\nthree");
    });
});

describe("rowSpan", () => {
    test("is undefined outside the rows of the selection", () => {
        const r = row("0123456789");
        expect(rowSpan(sel([2, 3], [5, 4]), 2, r)).toBeUndefined();
        expect(rowSpan(sel([2, 3], [5, 4]), 5, r)).toBeUndefined();
        expect(rowSpan(sel([2, 3], [5, 4]), 3, r)).toEqual([2, 10]);
        expect(rowSpan(sel([2, 3], [5, 4]), 4, r)).toEqual([0, 6]);
    });
});

describe("highlightRow", () => {
    const red = { type: "ansi", code: "\u001B[31m", endCode: "\u001B[39m" } as const;
    const inverse = { type: "ansi", code: "\u001B[7m", endCode: "\u001B[27m" } as const;
    const bold = { type: "ansi", code: "\u001B[1m", endCode: "\u001B[22m" } as const;

    test("paints the selected cells and leaves the rest as they are", () => {
        const r: ScreenRow = [cell("a"), cell("b", [red, bold]), cell("c"), cell("d")];
        const painted = highlightRow(sel([1, 0], [2, 0]), 0, r)!;
        expect(painted.map((c) => c.value)).toEqual(["a", "b", "c", "d"]);
        expect(painted[0]).toBe(r[0]);
        expect(painted[3]).toBe(r[3]);
        const codes = (c: ScreenCell) => c.styles.map((s) => s.code);
        expect(codes(painted[1]!)).toContain("\u001B[1m"); // bold is kept
        expect(codes(painted[1]!)).not.toContain("\u001B[31m"); // the colour is replaced by the selection's
        expect(codes(painted[1]!).some((c) => c.startsWith("\u001B[48;"))).toBe(true);
        expect(codes(painted[2]!).some((c) => c.startsWith("\u001B[38;"))).toBe(true);
    });

    test("an inverse cell does not cancel out the highlight", () => {
        const r: ScreenRow = [cell("x", [inverse])];
        const painted = highlightRow(sel([0, 0], [0, 0]), 0, r)!;
        expect(painted[0]!.styles.map((s) => s.code)).not.toContain("\u001B[7m");
    });

    test("is undefined for a row the selection does not touch", () => {
        expect(highlightRow(sel([0, 1], [3, 1]), 0, row("abcd"))).toBeUndefined();
    });

    test("the same cell is painted the same way every time (cells are shared between frames)", () => {
        const shared = cell("z");
        const a = highlightRow(sel([0, 0], [0, 0]), 0, [shared])!;
        const b = highlightRow(sel([0, 0], [0, 0]), 0, [shared])!;
        expect(a[0]).toBe(b[0]);
    });
});

describe("osc52Sequence", () => {
    test("is the terminal's set-clipboard sequence", () => {
        expect(osc52Sequence("héllo", {})).toBe(`\u001B]52;c;${Buffer.from("héllo").toString("base64")}\u0007`);
    });

    test("is wrapped for tmux, which would otherwise swallow it", () => {
        const sequence = osc52Sequence("x", { TMUX: "/tmp/tmux-1/default,1,0" });
        expect(sequence.startsWith("\u001BPtmux;\u001B\u001B]52;c;")).toBe(true);
        expect(sequence.endsWith("\u0007\u001B\\")).toBe(true);
    });

    test("is left out for a text too long for a terminal to take", () => {
        expect(osc52Sequence("x".repeat(200_000), {})).toBe("");
    });
});

describe("the mouse drives the selection", () => {
    const copied: string[] = [];

    beforeEach(async () => {
        copied.length = 0;
        vi.resetModules();
        vi.doMock("#base/selection/clipboardWrite", () => ({
            osc52Sequence: () => "",
            copyToClipboard: async (text: string) => {
                copied.push(text);
                return true;
            },
        }));
        getScreenTap().frame = screen(
            "│ one two three │ side │",
            "│ four five six │ side │",
            "│ seven         │ side │"
        );
    });

    afterEach(() => {
        vi.doUnmock("#base/selection/clipboardWrite");
        const tap = getScreenTap();
        tap.frame = [];
        tap.highlight = undefined;
    });

    const mouse = (type: MouseEvent["type"], x: number, y: number, extra: Partial<MouseEvent> = {}): MouseEvent => ({
        type,
        button: "left",
        x,
        y,
        ctrl: false,
        shift: false,
        alt: false,
        ...extra,
    });

    async function controller() {
        const { screenSelection } = await import("#base/selection/screenSelection");
        return screenSelection;
    }

    test("a drag highlights, and letting go copies what was selected", async () => {
        const s = await controller();
        s.handleMouse(mouse("press", 2, 0));
        expect(s.current).toBeUndefined(); // not yet: it could still be a click
        s.handleMouse(mouse("move", 6, 0));
        expect(s.current).toBeDefined();
        expect(getScreenTap().highlight).toBeDefined();
        expect(copied).toEqual([]);
        s.handleMouse(mouse("release", 6, 0));
        await vi.waitFor(() => expect(copied).toEqual(["one t"]));
        expect(s.current).toBeDefined(); // stays highlighted
    });

    test("a click with no movement selects nothing and copies nothing", async () => {
        const s = await controller();
        s.handleMouse(mouse("press", 4, 1));
        s.handleMouse(mouse("release", 4, 1));
        expect(s.current).toBeUndefined();
        expect(getScreenTap().highlight).toBeUndefined();
        expect(copied).toEqual([]);
    });

    test("the drag stays in the panel it started in", async () => {
        const s = await controller();
        s.handleMouse(mouse("press", 2, 0));
        s.handleMouse(mouse("move", 25, 2));
        s.handleMouse(mouse("release", 25, 2));
        await vi.waitFor(() => expect(copied).toHaveLength(1));
        expect(copied[0]).toBe("one two three\nfour five six\nseven");
    });

    test("Alt+drag takes a rectangle", async () => {
        const s = await controller();
        s.handleMouse(mouse("press", 2, 0, { alt: true }));
        s.handleMouse(mouse("move", 4, 1, { alt: true }));
        s.handleMouse(mouse("release", 4, 1, { alt: true }));
        await vi.waitFor(() => expect(copied).toEqual(["one\nfou"]));
    });

    test("the next click, a key or the wheel removes the highlight", async () => {
        const s = await controller();
        const select = () => {
            s.handleMouse(mouse("press", 2, 0));
            s.handleMouse(mouse("move", 6, 0));
            s.handleMouse(mouse("release", 6, 0));
        };
        select();
        s.handleMouse(mouse("press", 10, 2));
        expect(s.current).toBeUndefined();
        expect(getScreenTap().highlight).toBeUndefined();
        select();
        s.clear(); // what a key press does
        expect(s.current).toBeUndefined();
        select();
        s.handleMouse(mouse("press", 1, 1, { button: "wheelDown" }));
        expect(s.current).toBeUndefined();
    });

    test("a press on a border (the chat's drag handle) never starts a selection", async () => {
        const s = await controller();
        s.handleMouse(mouse("press", 0, 0));
        s.handleMouse(mouse("move", 6, 1));
        expect(s.current).toBeUndefined();
    });

    test("Ctrl+click and Shift+click are the list's own, not selections", async () => {
        const s = await controller();
        s.handleMouse(mouse("press", 2, 0, { ctrl: true }));
        s.handleMouse(mouse("move", 6, 0, { ctrl: true }));
        expect(s.current).toBeUndefined();
    });

    test("a release the terminal never reported ends the drag when the pointer moves with no button", async () => {
        const s = await controller();
        s.handleMouse(mouse("press", 2, 0));
        s.handleMouse(mouse("move", 6, 0));
        s.handleMouse(mouse("move", 7, 0, { button: "none" }));
        await vi.waitFor(() => expect(copied).toEqual(["one t"]));
    });

    test("whitespace alone is not copied", async () => {
        getScreenTap().frame = screen("          ", "          ");
        const s = await controller();
        s.handleMouse(mouse("press", 1, 0));
        s.handleMouse(mouse("move", 6, 1));
        s.handleMouse(mouse("release", 6, 1));
        expect(copied).toEqual([]);
        expect(s.current).toBeUndefined();
    });

    test("nothing happens until Ink has painted a frame", async () => {
        getScreenTap().frame = [];
        const s = await controller();
        s.handleMouse(mouse("press", 2, 0));
        s.handleMouse(mouse("move", 6, 0));
        expect(s.current).toBeUndefined();
    });

    test("subscribers hear about every change (so the screen repaints)", async () => {
        vi.useFakeTimers();
        try {
            const s = await controller();
            const seen: number[] = [];
            const stop = s.subscribe(() => seen.push(s.getVersion()));
            s.handleMouse(mouse("press", 2, 0));
            s.handleMouse(mouse("move", 6, 0));
            s.handleMouse(mouse("move", 6, 0)); // same cell: not news
            vi.advanceTimersByTime(100);
            s.handleMouse(mouse("move", 7, 0));
            stop();
            expect(seen).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    test("a fast drag paints at a steady pace, and the selection itself is always current", async () => {
        vi.useFakeTimers();
        try {
            const s = await controller();
            let paints = 0;
            s.subscribe(() => paints++);
            s.handleMouse(mouse("press", 1, 0));
            for (let x = 2; x <= 12; x++) s.handleMouse(mouse("move", x, 0)); // eleven cells in the same instant
            expect(paints).toBe(1); // the first at once, the rest wait
            expect(s.current?.focus.x).toBe(12);
            vi.advanceTimersByTime(60);
            expect(paints).toBe(2);
            // A step of the drag after another wait paints at once again.
            vi.advanceTimersByTime(60);
            s.handleMouse(mouse("move", 13, 0));
            expect(paints).toBe(3);
        } finally {
            vi.useRealTimers();
        }
    });

    test("letting go paints the final position at once, copies what is highlighted and leaves nothing waiting", async () => {
        vi.useFakeTimers();
        try {
            const s = await controller();
            let paints = 0;
            s.subscribe(() => paints++);
            s.handleMouse(mouse("press", 2, 0));
            s.handleMouse(mouse("move", 4, 0));
            s.handleMouse(mouse("move", 6, 0)); // waiting for the pace
            expect(paints).toBe(1);
            s.handleMouse(mouse("release", 6, 0));
            expect(paints).toBe(2);
            await vi.waitFor(() => expect(copied).toEqual(["one t"]));
            vi.advanceTimersByTime(200);
            expect(paints).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    test("a press on a vertical-line glyph that is part of a text still starts a selection", async () => {
        getScreenTap().frame = screen("a │ b │ c", "next line");
        const s = await controller();
        s.handleMouse(mouse("press", 2, 0)); // the glyph itself
        s.handleMouse(mouse("move", 6, 0));
        expect(s.current).toBeDefined();
    });
});
