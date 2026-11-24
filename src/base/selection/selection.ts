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

/** Any of the box-drawing characters (lines, corners, tees): what a panel's border is made of. */
const BOX_DRAWING = /^[─-╿]$/u;
/** The box-drawing characters where lines meet (corners, tees, crosses): never part of a plain rule or a bar. */
const BOX_JOINT = /[┌-╋╒-╰]/u;

function isBoxDrawing(cell: ScreenCell | undefined): boolean {
    return cell !== undefined && BOX_DRAWING.test(cell.value);
}

/**
 * Whether the cell at (`x`, `y`) is the edge of a panel, not a `│` that is part of some text: a vertical line is an
 * edge when the row above or below has a border character in the same column (the line goes on, or a corner starts
 * or ends it).
 */
export function isPaneEdge(frame: readonly ScreenRow[], x: number, y: number): boolean {
    if (!isVerticalLine(frame[y]?.[x])) return false;
    return isBoxDrawing(frame[y - 1]?.[x]) || isBoxDrawing(frame[y + 1]?.[x]);
}

/**
 * The box-drawing glyphs (U+2500..U+257F, any weight: light, heavy, double, and their mixes) whose vertical arm goes
 * down (`┌ ┬ ├ ┼ ╒ ╔ ╭`…) and those whose arm goes up (`└ ┴ ┤ ╧ ╚ ╰`…), as ranges of code points from the Unicode chart.
 * Plain vertical lines are not here: `isVerticalLine` knows them.
 */
const ARM_DOWN_RANGES: readonly (readonly [number, number])[] = [
    [0x250c, 0x2513], // down + right / left
    [0x251c, 0x2533], // up + down + right / left, down + left + right
    [0x253c, 0x254b], // all four arms
    [0x2552, 0x2557], // double ┌ ┐
    [0x255e, 0x2566], // double ├ ┤ ┬
    [0x256a, 0x256e], // double crosses, ╭ ╮
];
const ARM_UP_RANGES: readonly (readonly [number, number])[] = [
    [0x2514, 0x251b], // up + right / left
    [0x251c, 0x252b], // up + down + right / left
    [0x2534, 0x254b], // up + left + right, all four arms
    [0x2558, 0x2563], // double └ ┘ ├ ┤
    [0x2567, 0x256c], // double ┴ and crosses
    [0x256f, 0x2570], // ╯ ╰
];

function inRanges(value: string, ranges: readonly (readonly [number, number])[]): boolean {
    const code = value.codePointAt(0);
    if (code === undefined || value.length !== 1) return false;
    return ranges.some(([from, to]) => code >= from && code <= to);
}

/** Whether the cell is a line that goes on downward from the row above: a vertical line, or a glyph with an arm up. */
function continuesUp(cell: ScreenCell | undefined): boolean {
    return cell !== undefined && (isVerticalLine(cell) || inRanges(cell.value, ARM_UP_RANGES));
}

/** Whether the cell is a line that goes on upward from the row below: a vertical line, or a glyph with an arm down. */
function continuesDown(cell: ScreenCell | undefined): boolean {
    return cell !== undefined && (isVerticalLine(cell) || inRanges(cell.value, ARM_DOWN_RANGES));
}

/**
 * Whether the cell is where a panel's side starts or ends on this row: a corner or tee whose vertical arm goes on into
 * a vertical line (or another corner / tee joined to it) above or below (the `┌` of a box whose top is on the same row
 * as some text of the pane beside it). A tee over a plain horizontal rule (`┬` above `─`) is not a side.
 */
function isPaneCorner(frame: readonly ScreenRow[], x: number, y: number): boolean {
    const value = frame[y]?.[x]?.value;
    if (value === undefined) return false;
    return (
        (inRanges(value, ARM_DOWN_RANGES) && continuesUp(frame[y + 1]?.[x])) ||
        (inRanges(value, ARM_UP_RANGES) && continuesDown(frame[y - 1]?.[x]))
    );
}

/** Whether the cell is a limit of the pane on its row: a panel's side, or the corner / tee where a side starts or ends. */
export const isPaneLimit = (frame: readonly ScreenRow[], x: number, y: number): boolean =>
    isPaneEdge(frame, x, y) || isPaneCorner(frame, x, y);

/**
 * The columns of the pane around column `x` of row `y`: between the panel edges on each side of it (or the screen's
 * edge). A selection that starts there stays there, so dragging down a panel next to another one (the task list and
 * the chat, a source list and the metadata box) never takes the other's text along — also from the row where the other
 * panel's top border is (`text…┌── Title ──┐`).
 */
export function paneBounds(frame: readonly ScreenRow[], x: number, y: number): ColumnBounds {
    const row = frame[y] ?? [];
    let left = 0;
    for (let i = Math.min(x, row.length - 1); i >= 0; i--) {
        if (isPaneLimit(frame, i, y)) {
            left = i + 1;
            break;
        }
    }
    let right = row.length;
    for (let i = Math.max(x, 0); i < row.length; i++) {
        if (isPaneLimit(frame, i, y)) {
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

/** A line made only of box-drawing characters (and spaces). */
const BORDER_LINE = /^[\s─-╿]+$/u;

/**
 * A row that is a panel's top, bottom or divider border: made only of box-drawing characters AND joined to a corner
 * or a tee, in the row itself or just outside the selectable columns. A bare run of `━` (a progress bar, a rule the
 * user chose to select) is text and is kept.
 */
function isBorderRow(text: string, row: ScreenRow, bounds: ColumnBounds): boolean {
    if (!BORDER_LINE.test(text)) return false;
    if (BOX_JOINT.test(text)) return true;
    const outside = [row[bounds.left - 1], row[bounds.right]];
    return outside.some((cell) => cell !== undefined && BOX_JOINT.test(cell.value));
}

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
        if (text !== "" && isBorderRow(text, row, selection.bounds)) continue;
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
