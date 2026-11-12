export interface WindowRow {
    key: string;
    /** Terminal rows the row takes. Defaults to 1. */
    height?: number;
    /**
     * How many of the rows right below belong with this one (a title bar and its block). While this row is the
     * focused one they are kept in view too, as far as the view is tall enough to also hold this row.
     */
    focusSpan?: number;
}

const rowHeight = (row: WindowRow) => row.height ?? 1;

/**
 * The part of `rows` that fits in `viewHeight` terminal rows while keeping `focusKey` visible, with
 * one row of context kept below it (or the rows it has a `focusSpan` of). Rows only start scrolling once the cursor
 * gets near the bottom, and a list that fits is returned whole.
 */
export function windowRows<T extends WindowRow>(rows: T[], focusKey: string | undefined, viewHeight: number): T[] {
    const total = rows.reduce((sum, row) => sum + rowHeight(row), 0);
    if (rows.length === 0 || total <= viewHeight) return rows;

    const focusIndex = focusKey === undefined ? -1 : rows.findIndex((row) => row.key === focusKey);
    const first = Math.max(0, focusIndex);
    const span = Math.max(1, rows[first]?.focusSpan ?? 1);

    // The last row to show: the end of the focused row's block, but never so far down that the focused row itself
    // would not fit above it.
    let anchor = Math.min(rows.length - 1, first + span);
    while (anchor > first && rows.slice(first, anchor + 1).reduce((sum, row) => sum + rowHeight(row), 0) > viewHeight) {
        anchor--;
    }

    let start = anchor;
    let used = rowHeight(rows[anchor]!);
    while (start > 0 && used + rowHeight(rows[start - 1]!) <= viewHeight) {
        start--;
        used += rowHeight(rows[start]!);
    }
    let end = anchor + 1;
    while (end < rows.length && used + rowHeight(rows[end]!) <= viewHeight) {
        used += rowHeight(rows[end]!);
        end++;
    }
    return rows.slice(start, end);
}
