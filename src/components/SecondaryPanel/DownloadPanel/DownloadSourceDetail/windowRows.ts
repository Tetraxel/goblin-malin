export interface WindowRow {
    key: string;
    /** Terminal rows the row takes. Defaults to 1. */
    height?: number;
}

const rowHeight = (row: WindowRow) => row.height ?? 1;

/**
 * The part of `rows` that fits in `viewHeight` terminal rows while keeping `focusKey` visible, with
 * one row of context kept below it. Rows only start scrolling once the cursor gets near the bottom,
 * and a list that fits is returned whole.
 */
export function windowRows<T extends WindowRow>(rows: T[], focusKey: string | undefined, viewHeight: number): T[] {
    const total = rows.reduce((sum, row) => sum + rowHeight(row), 0);
    if (rows.length === 0 || total <= viewHeight) return rows;

    const focusIndex = focusKey === undefined ? -1 : rows.findIndex((row) => row.key === focusKey);
    const anchor = Math.min(rows.length - 1, Math.max(0, focusIndex) + 1);

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
