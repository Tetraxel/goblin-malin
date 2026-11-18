/**
 * Selecting text on the screen: which cells are selected, what text they hold, and how they are painted.
 *
 * Pure functions over the cells Ink painted (`ScreenRow`), so they are tested without a terminal. The mouse handling
 * that drives them is `screenSelection.ts`.
 */
import type { AnsiStyle, ScreenCell, ScreenRow } from "./screenTap";

export type Point = { x: number; y: number };

/** The columns a selection may use: `left` included, `right` excluded. */
export type ColumnBounds = { left: number; right: number };

export type Selection = {
    /** Where the button went down. */
    anchor: Point;
    /** Where the pointer is (or was released). */
    focus: Point;
    /**
     * false: text flows like in a terminal (the first row from the anchor to the end, whole rows between, the last
     * row up to the focus). true: the rectangle the two corners make.
     */
    block: boolean;
    bounds: ColumnBounds;
};

/** The vertical lines the app draws its panels with: they are edges, not text. */
const VERTICAL_LINES = new Set(["│", "┃", "║", "╎", "╏", "┆", "┇", "┊", "┋"]);

export function isVerticalLine(cell: ScreenCell | undefined): boolean {
    return cell !== undefined && VERTICAL_LINES.has(cell.value);
}

/**
 * The columns of the pane around column `x` of `row`: between the vertical lines on each side of it (or the screen's
 * edge). A selection that starts there stays there, so dragging down a panel next to another one (the task list and
 * the chat, a source list and the metadata box) never takes the other's text along.
 */
export function paneBounds(row: ScreenRow, x: number): ColumnBounds {
    let left = 0;
    for (let i = Math.min(x, row.length - 1); i >= 0; i--) {
        if (isVerticalLine(row[i])) {
            left = i + 1;
            break;
        }
    }
    let right = row.length;
    for (let i = Math.max(x, 0); i < row.length; i++) {
        if (isVerticalLine(row[i])) {
            right = i;
            break;
        }
    }
    return { left, right: Math.max(left, right) };
}

/** Moves a point inside the bounds and the screen. */
export function clampPoint(point: Point, bounds: ColumnBounds, rows: number): Point {
    return {
        x: Math.min(Math.max(point.x, bounds.left), Math.max(bounds.left, bounds.right - 1)),
        y: Math.min(Math.max(point.y, 0), Math.max(0, rows - 1)),
    };
}

function ordered(selection: Selection): [Point, Point] {
    const { anchor, focus } = selection;
    return anchor.y < focus.y || (anchor.y === focus.y && anchor.x <= focus.x) ? [anchor, focus] : [focus, anchor];
}

/** The rows a selection covers (both ends included). */
export function selectionRows(selection: Selection): { first: number; last: number } {
    return {
        first: Math.min(selection.anchor.y, selection.focus.y),
        last: Math.max(selection.anchor.y, selection.focus.y),
    };
}

/**
 * The columns of row `y` that are selected, `[from, to)`, or `undefined` for none. A wide character is never cut in
 * half: the span grows to take both its cells.
 */
export function rowSpan(selection: Selection, y: number, row: ScreenRow): [number, number] | undefined {
    const [start, end] = ordered(selection);
    const { first, last } = selectionRows(selection);
    if (y < first || y > last) return undefined;
    const { bounds } = selection;
    let from: number;
    let to: number;
    if (selection.block) {
        from = Math.min(selection.anchor.x, selection.focus.x);
        to = Math.max(selection.anchor.x, selection.focus.x) + 1;
    } else {
        from = y === start.y ? start.x : bounds.left;
        to = y === end.y ? end.x + 1 : bounds.right;
    }
    from = Math.max(from, bounds.left);
    to = Math.min(to, bounds.right, row.length);
    if (to <= from) return undefined;
    // Never half a wide character: its second cell has no value of its own.
    while (from > bounds.left && row[from]?.value === "") from--;
    while (to < row.length && row[to]?.value === "") to++;
    return [from, to];
}

/** A line made only of the box-drawing characters of a border (and spaces): not text. */
const BORDER_LINE = /^[\s─-╿]+$/u;

/**
 * The text of the selection, as one would paste it: a line per screen row, the blanks at the end of each row cut,
 * the indentation the panel's padding added removed, rows that are only a border line dropped, no empty line at
 * either end.
 */
export function selectedText(frame: readonly ScreenRow[], selection: Selection): string {
    const { first, last } = selectionRows(selection);
    const [start] = ordered(selection);
    const lines: { text: string; flush: boolean }[] = [];
    for (let y = first; y <= last && y < frame.length; y++) {
        const row = frame[y] ?? [];
        const span = rowSpan(selection, y, row);
        let text = "";
        if (span) {
            for (let x = span[0]; x < span[1]; x++) text += row[x]?.value ?? " ";
        }
        text = text.trimEnd();
        if (text !== "" && BORDER_LINE.test(text)) continue;
        // A row that starts where the selection's left edge is (the pane's, or the block's) carries that edge's
        // indentation; only the first row of a flowing selection starts in the middle of the text.
        lines.push({ text, flush: selection.block || y !== start.y || start.x <= selection.bounds.left });
    }
    // Leave out what every row shares at its start: the padding between the border and the text.
    let indent = Infinity;
    for (const { text, flush } of lines) {
        if (flush && text !== "") indent = Math.min(indent, text.length - text.trimStart().length);
    }
    const trimmed = lines.map(({ text, flush }) => (flush && Number.isFinite(indent) ? text.slice(indent) : text));
    while (trimmed.length > 0 && trimmed[0] === "") trimmed.shift();
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
    return trimmed.join("\n");
}

// The look of the selected cells: a fixed blue background with white text, whatever was there (a cell that was
// already inverse or coloured would otherwise show no change).
const SELECTION_BACKGROUND: AnsiStyle = { type: "ansi", code: "\u001B[48;2;38;79;120m", endCode: "\u001B[49m" };
const SELECTION_FOREGROUND: AnsiStyle = { type: "ansi", code: "\u001B[38;2;255;255;255m", endCode: "\u001B[39m" };
const REPLACED_END_CODES = new Set([
    SELECTION_BACKGROUND.endCode,
    SELECTION_FOREGROUND.endCode,
    "\u001B[27m", // inverse
]);

// Cells are shared between rows and frames, so a cell's selected look is made once.
const selectedLooks = new WeakMap<ScreenCell, ScreenCell>();
const BLANK: ScreenCell = Object.freeze({ type: "char", value: " ", fullWidth: false, styles: [] });

function selectedLook(cell: ScreenCell): ScreenCell {
    let look = selectedLooks.get(cell);
    if (!look) {
        look = {
            ...cell,
            styles: [
                ...cell.styles.filter((s) => !REPLACED_END_CODES.has(s.endCode)),
                SELECTION_BACKGROUND,
                SELECTION_FOREGROUND,
            ],
        };
        selectedLooks.set(cell, look);
    }
    return look;
}

/** Row `y` with the selected cells painted as selected, or `undefined` when none of it is selected. */
export function highlightRow(selection: Selection, y: number, row: ScreenRow): ScreenCell[] | undefined {
    const span = rowSpan(selection, y, row);
    if (!span) return undefined;
    const painted: ScreenCell[] = [];
    for (let x = 0; x < row.length; x++) {
        const cell = row[x] ?? BLANK;
        painted.push(x >= span[0] && x < span[1] ? selectedLook(cell) : cell);
    }
    return painted;
}
