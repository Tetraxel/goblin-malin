/**
 * Layout of the chat's text line: what the user types is wrapped over a few rows, and the cursor keeps in view. Pure
 * functions, so the component stays a thin shell around them.
 */

/** Rows the text line grows to before it scrolls. */
export const MAX_INPUT_ROWS = 4;

/** Columns a character takes: 2 for the wide ones (East Asian, emoji), 1 otherwise. */
export function charWidth(ch: string): number {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x1100) return 1;
    if (
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1faff)
    ) {
        return 2;
    }
    return 1;
}

/**
 * Where each row of the wrapped text starts (an index into `chars`). There is always a row for the cursor after the
 * last character, so a line that is exactly full gets a new row instead of a cursor outside the box.
 */
export function rowStarts(chars: readonly string[], width: number): number[] {
    const limit = Math.max(1, width);
    const starts = [0];
    let start = 0;
    let used = 0;
    for (let i = 0; i < chars.length; i++) {
        const w = charWidth(chars[i]);
        if (used > 0 && used + w > limit) {
            // A row breaks after the last space it holds, so a word is not cut; a word longer than a row is.
            let breakAt = i;
            if (chars[i] !== " ") {
                for (let j = i - 1; j > start; j--) {
                    if (chars[j] === " ") {
                        breakAt = j + 1;
                        break;
                    }
                }
            }
            starts.push(breakAt);
            start = breakAt;
            used = 0;
            for (let j = breakAt; j < i; j++) used += charWidth(chars[j]);
        }
        used += w;
    }
    if (used + 1 > limit) starts.push(chars.length);
    return starts;
}

/** The row the cursor is on. A cursor at the start of a wrapped row is on that row. */
export function cursorRow(starts: readonly number[], cursor: number): number {
    let row = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= cursor) row = i;
    return row;
}

/** How many rows the line takes for this text: its wrapped rows, up to `maxRows`. */
export function inputRowCount(value: string, width: number, maxRows = MAX_INPUT_ROWS): number {
    return Math.min(Math.max(1, maxRows), rowStarts(Array.from(value), width).length);
}

/** The first row to show so that the cursor's row is in view, showing the last rows when the cursor is at the end. */
export function firstVisibleRow(totalRows: number, cursor: number, maxRows: number): number {
    const lastStart = Math.max(0, totalRows - maxRows);
    return Math.max(0, Math.min(lastStart, cursor - maxRows + 1));
}

export type InputRow = {
    /** Text before the cursor, the character under it ("" when the cursor is not on this row), and the rest. */
    before: string;
    cursor: string;
    after: string;
};

/**
 * The rows to draw for `value` with the cursor at `cursor` (an index in characters): at most `maxRows`, scrolled so
 * the cursor shows.
 */
export function layoutInput(value: string, cursor: number, width: number, maxRows = MAX_INPUT_ROWS): InputRow[] {
    const chars = Array.from(value);
    const at = Math.max(0, Math.min(cursor, chars.length));
    const starts = rowStarts(chars, width);
    const row = cursorRow(starts, at);
    const first = firstVisibleRow(starts.length, row, maxRows);
    const rows: InputRow[] = [];
    for (let r = first; r < Math.min(starts.length, first + maxRows); r++) {
        const from = starts[r];
        const to = starts[r + 1] ?? chars.length;
        if (r === row) {
            const local = at - from;
            const text = chars.slice(from, to);
            rows.push({
                before: text.slice(0, local).join(""),
                // The cursor after the last character is drawn on a space.
                cursor: text[local] ?? " ",
                after: text.slice(local + 1).join(""),
            });
        } else {
            rows.push({ before: chars.slice(from, to).join(""), cursor: "", after: "" });
        }
    }
    return rows;
}

/** Text typed or pasted into the line: one line, no control characters. */
export function sanitizeTyped(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\r\n|\r|\n|\t/g, " ").replace(/[\u0000-\u001f\u007f]/g, "");
}
