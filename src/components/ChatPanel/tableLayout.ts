import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";
import { type MdTable } from "./markdown";

/** A row of the drawn table, in the shape the chat's rows take. */
export type TableRow = { text: string; lead: string; indent: number };

const ESC = "\u001b";
const bold = (s: string): string => `${ESC}[1m${s}${ESC}[22m`;
const dim = (s: string): string => `${ESC}[2m${s}${ESC}[22m`;

/** A column that is squeezed is never narrower than this (or than its own content, if that is shorter). */
const MIN_COLUMN = 10;

const wrapCell = (cell: string, width: number): string[] =>
    wrapAnsi(cell, Math.max(1, width), { hard: true, trim: true }).split("\n");

function pad(text: string, width: number, align: MdTable["align"][number]): string {
    const gap = Math.max(0, width - stringWidth(text));
    if (align === "right") return " ".repeat(gap) + text;
    if (align === "center") return " ".repeat(Math.floor(gap / 2)) + text + " ".repeat(gap - Math.floor(gap / 2));
    return text + " ".repeat(gap);
}

/** The width of the longest word of a cell: a column should not be squeezed below it when it can be helped. */
const longestWord = (cell: string): number => Math.max(0, ...cell.split(/\s+/).map((w) => stringWidth(w)));

/** Widths for the columns of `table` inside `available` columns, or undefined when they would be too narrow to read. */
export function columnWidths(table: MdTable, available: number): number[] | undefined {
    const all = [table.header, ...table.rows];
    const natural = table.header.map((_, c) => Math.max(1, ...all.map((row) => stringWidth(row[c] ?? ""))));
    const total = natural.reduce((a, b) => a + b, 0);
    if (total <= available) return natural;

    const floor = table.header.map((_, c) =>
        Math.min(natural[c], MIN_COLUMN, Math.max(3, ...all.map((row) => longestWord(row[c] ?? ""))))
    );
    if (floor.reduce((a, b) => a + b, 0) > available) return undefined;

    // Everyone starts at their floor; what is left goes round the columns that still want more.
    const widths = [...floor];
    let left = available - widths.reduce((a, b) => a + b, 0);
    while (left > 0) {
        let moved = false;
        for (let c = 0; c < widths.length && left > 0; c++) {
            if (widths[c] < natural[c]) {
                widths[c]++;
                left--;
                moved = true;
            }
        }
        if (!moved) break;
    }
    return widths;
}

/** The table as a grid of box-drawing lines. */
function grid(table: MdTable, widths: number[]): TableRow[] {
    const edge = (left: string, mid: string, right: string): string =>
        dim(left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right);
    const bar = dim("│");
    const lines: TableRow[] = [];
    const push = (text: string): void => void lines.push({ text, lead: "", indent: 0 });

    const drawRow = (cells: string[], header: boolean): number => {
        const wrapped = widths.map((w, c) => wrapCell(cells[c] ?? "", w).map((l) => (header ? bold(l) : l)));
        const height = Math.max(1, ...wrapped.map((w) => w.length));
        for (let k = 0; k < height; k++) {
            push(
                bar + widths.map((w, c) => ` ${pad(wrapped[c][k] ?? "", w, table.align[c] ?? "left")} `).join(bar) + bar
            );
        }
        return height;
    };

    push(edge("┌", "┬", "┐"));
    drawRow(table.header, true);
    push(edge("├", "┼", "┤"));
    // Rows that wrap over several lines are set apart, so it is clear where one ends.
    const separate = table.rows.some((row) => widths.some((w, c) => stringWidth(row[c] ?? "") > w));
    table.rows.forEach((row, r) => {
        drawRow(row, false);
        if (separate && r < table.rows.length - 1) push(edge("├", "┼", "┤"));
    });
    push(edge("└", "┴", "┘"));
    return lines;
}

/** A table too wide for the panel as one card per row: the first cell as a title, then "column: value" lines. */
function cards(table: MdTable, room: number): TableRow[] {
    const lines: TableRow[] = [];
    const inner = Math.max(1, room - 2);
    for (const row of table.rows.length > 0 ? table.rows : [table.header]) {
        wrapCell(bold(row[0] ?? ""), inner).forEach((text, i) =>
            lines.push({ text, lead: i === 0 ? "▪" : "", indent: 2 })
        );
        for (let c = 1; c < table.header.length; c++) {
            const value = row[c] ?? "";
            if (value === "") continue;
            const label = table.rows.length > 0 && table.header[c] !== "" ? `${dim(table.header[c] + ":")} ` : "";
            wrapCell(label + value, inner).forEach((text) => lines.push({ text, lead: "", indent: 2 }));
        }
    }
    return lines;
}

/** The rows of a table in `room` columns: a grid when it fits (cells wrap if need be), otherwise cards. */
export function layoutTable(table: MdTable, room: number): TableRow[] {
    // Per column: a space on each side and one border, and a border at the end.
    const chrome = table.header.length * 3 + 1;
    const widths = columnWidths(table, room - chrome);
    return widths ? grid(table, widths) : cards(table, room);
}
