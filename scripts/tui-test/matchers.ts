import { palette256ToRgb } from "./palette.ts";

/**
 * Pure helpers for the harness's screen checks: finding text on the screen (by cell, so a wide emoji does not shift
 * the columns), comparing a style, masking and diffing a golden snapshot. No terminal, no process: unit-tested.
 */

/** A rectangle of the screen, 1-based like the mouse reports (`col` 1 is the leftmost column). */
export interface Region {
    row: number;
    col: number;
    width: number;
    height: number;
}

/** What to look for on the screen: a literal `contains` or a regular expression `matches` (exactly one of them). */
export interface TextMatch {
    contains?: string;
    /** Regular expression source. Flags default to `m` (so `^` and `$` are per line). */
    matches?: string;
    flags?: string;
    /** Only look in this row (1-based). */
    row?: number;
    /** Only look in this rectangle. */
    region?: Region;
}

/** One screen line: its text and, for every character of the text, the (0-based) cell column it starts at. */
export interface Line {
    text: string;
    colOf: number[];
}

/** Where a match is, 1-based, in cells. */
export interface Location {
    row: number;
    col: number;
    /** Cells the match covers. */
    width: number;
    text: string;
}

/** A line made of text where every character is one cell wide (tests and plain snapshots). */
export function plainLine(text: string): Line {
    const colOf: number[] = [];
    let col = 0;
    for (const ch of text) {
        for (let i = 0; i < ch.length; i++) colOf.push(col);
        col += 1;
    }
    return { text, colOf };
}

export function toLines(plain: string): Line[] {
    return plain.split("\n").map(plainLine);
}

/** Cells that characters at `text[index]` cover: up to the next character's column (a wide char is 2). */
function cellWidth(line: Line, start: number, end: number): number {
    const first = line.colOf[start] ?? 0;
    const last = end < line.text.length ? (line.colOf[end] ?? first) : lineCells(line);
    return Math.max(1, last - first);
}

function lineCells(line: Line): number {
    const last = line.text.length - 1;
    if (last < 0) return 0;
    // The last character's width is not stored: wide characters are the only ones above one cell.
    const ch = [...line.text].at(-1) ?? "";
    return (line.colOf[last] ?? 0) + (isWide(ch) ? 2 : 1);
}

function isWide(ch: string): boolean {
    const cp = ch.codePointAt(0) ?? 0;
    return (
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1faff)
    );
}

/** The lines of the rectangle (cells outside it are cut off). Rows and columns are 1-based. */
export function cropRegion(lines: Line[], region: Region): Line[] {
    const out: Line[] = [];
    const firstCol = region.col - 1;
    const endCol = firstCol + region.width;
    for (let r = region.row - 1; r < region.row - 1 + region.height; r++) {
        const line = lines[r] ?? { text: "", colOf: [] };
        let text = "";
        const colOf: number[] = [];
        let index = 0;
        for (const ch of line.text) {
            const col = line.colOf[index] ?? 0;
            if (col >= firstCol && col < endCol) {
                text += ch;
                for (let k = 0; k < ch.length; k++) colOf.push(col - firstCol);
            }
            index += ch.length;
        }
        out.push({ text: text.replace(/\s+$/, ""), colOf: colOf.slice(0, text.replace(/\s+$/, "").length) });
    }
    return out;
}

/** The part of the screen a {@link TextMatch} is limited to, with the offset of its top-left cell. */
export function scope(
    lines: Line[],
    match: Pick<TextMatch, "row" | "region">
): { lines: Line[]; row0: number; col0: number } {
    if (match.region) {
        return { lines: cropRegion(lines, match.region), row0: match.region.row - 1, col0: match.region.col - 1 };
    }
    if (match.row !== undefined) {
        return { lines: [lines[match.row - 1] ?? { text: "", colOf: [] }], row0: match.row - 1, col0: 0 };
    }
    return { lines, row0: 0, col0: 0 };
}

export function describeMatch(match: TextMatch): string {
    const what =
        match.contains !== undefined ? JSON.stringify(match.contains) : `/${match.matches}/${match.flags ?? "m"}`;
    const where = match.region
        ? ` in region ${match.region.width}x${match.region.height} at row ${match.region.row}, col ${match.region.col}`
        : match.row !== undefined
          ? ` on row ${match.row}`
          : "";
    return what + where;
}

/** Every place the match occurs, in reading order. Throws when the match names neither or both of `contains`/`matches`. */
export function findAll(lines: Line[], match: TextMatch): Location[] {
    if ((match.contains === undefined) === (match.matches === undefined)) {
        throw new Error('A text match needs exactly one of "contains" or "matches"');
    }
    const { lines: area, row0, col0 } = scope(lines, match);
    const joined = area.map((l) => l.text).join("\n");
    const lineStart: number[] = [];
    let offset = 0;
    for (const line of area) {
        lineStart.push(offset);
        offset += line.text.length + 1;
    }

    const found: Location[] = [];
    const push = (index: number, length: number): void => {
        let row = 0;
        while (row + 1 < lineStart.length && lineStart[row + 1]! <= index) row++;
        const line = area[row]!;
        const at = index - lineStart[row]!;
        const sameLineLength = Math.min(length, line.text.length - at);
        found.push({
            row: row0 + row + 1,
            col: col0 + (line.colOf[at] ?? at) + 1,
            width: cellWidth(line, at, at + Math.max(1, sameLineLength)),
            text: joined.slice(index, index + length),
        });
    };

    if (match.contains !== undefined) {
        if (match.contains === "") return [];
        let from = 0;
        for (;;) {
            const index = joined.indexOf(match.contains, from);
            if (index < 0) break;
            push(index, match.contains.length);
            from = index + match.contains.length;
        }
    } else {
        const flags = (match.flags ?? "m").replace(/g/g, "") + "g";
        const regex = new RegExp(match.matches!, flags);
        let m: RegExpExecArray | null;
        while ((m = regex.exec(joined)) !== null) {
            if (m[0] === "") {
                regex.lastIndex++;
                continue;
            }
            push(m.index, m[0].length);
        }
    }
    return found;
}

export function countMatches(lines: Line[], match: TextMatch): number {
    return findAll(lines, match).length;
}

/** The screen text of the rectangle (or the whole screen), as a golden file stores it. */
export function regionText(lines: Line[], region?: Region): string {
    const area = region ? cropRegion(lines, region) : lines;
    const out = area.map((l) => l.text.replace(/\s+$/, ""));
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return out.join("\n");
}

/** Replaces what changes from run to run (a duration, a counter, a date) with a fixed marker before comparing. */
export function maskText(text: string, patterns: string[] | undefined): string {
    let out = text;
    for (const pattern of patterns ?? []) out = out.replace(new RegExp(pattern, "g"), "‹*›");
    return out;
}

/**
 * A line-by-line diff of two texts (`-` expected, `+` actual, two lines of context), or "" when they are the same.
 * Longest-common-subsequence based, so a line inserted at the top does not mark every line below as changed.
 */
export function lineDiff(expected: string, actual: string, context = 2): string {
    const a = expected.split("\n");
    const b = actual.split("\n");
    if (expected === actual) return "";
    const n = a.length;
    const m = b.length;
    // Beyond a screen's size an LCS table is not worth it: compare row by row.
    const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
        }
    }
    const ops: Array<{ op: " " | "-" | "+"; text: string }> = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            ops.push({ op: " ", text: a[i]! });
            i++;
            j++;
        } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
            ops.push({ op: "-", text: a[i++]! });
        } else {
            ops.push({ op: "+", text: b[j++]! });
        }
    }
    while (i < n) ops.push({ op: "-", text: a[i++]! });
    while (j < m) ops.push({ op: "+", text: b[j++]! });

    const keep = new Array<boolean>(ops.length).fill(false);
    ops.forEach((o, k) => {
        if (o.op === " ") return;
        for (let d = -context; d <= context; d++) if (ops[k + d]) keep[k + d] = true;
    });
    const out: string[] = [];
    let skipped = false;
    ops.forEach((o, k) => {
        if (!keep[k]) {
            skipped = true;
            return;
        }
        if (skipped && out.length > 0) out.push("  …");
        skipped = false;
        out.push(`${o.op} ${o.text}`);
    });
    return out.join("\n");
}

//----------------------//
//        STYLES        //
//----------------------//

/** A cell's colour as the terminal holds it. */
export type CellColor =
    { kind: "default" } | { kind: "palette"; index: number } | { kind: "rgb"; rgb: [number, number, number] };

export interface CellStyle {
    fg: CellColor;
    bg: CellColor;
    bold: boolean;
    dim: boolean;
    italic: boolean;
    underline: boolean;
    inverse: boolean;
    strikethrough: boolean;
}

/**
 * What a style check asks for. A colour is `"default"`, a palette index (`2` is green: exact) or `"#rrggbb"` (what the
 * cell is drawn in: a palette colour counts through the standard xterm palette).
 */
export interface StyleSpec {
    fg?: string | number;
    bg?: string | number;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    inverse?: boolean;
    strikethrough?: boolean;
}

export function colorToString(color: CellColor): string {
    if (color.kind === "default") return "default";
    if (color.kind === "palette") return `palette ${color.index}`;
    return "#" + color.rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function colorMatches(color: CellColor, wanted: string | number): boolean {
    if (wanted === "default") return color.kind === "default";
    if (typeof wanted === "number") return color.kind === "palette" && color.index === wanted;
    const hex = /^#?([0-9a-f]{6})$/i.exec(wanted)?.[1];
    if (!hex) throw new Error(`Unknown colour "${wanted}": use "default", a palette index or "#rrggbb"`);
    if (color.kind === "default") return false;
    const rgb = color.kind === "rgb" ? color.rgb : palette256ToRgb(color.index);
    return rgb.map((v) => v.toString(16).padStart(2, "0")).join("") === hex.toLowerCase();
}

/** What differs between a cell's style and the wanted one ("" when it matches). */
export function styleMismatch(actual: CellStyle, wanted: StyleSpec): string {
    const problems: string[] = [];
    if (wanted.fg !== undefined && !colorMatches(actual.fg, wanted.fg)) {
        problems.push(`fg is ${colorToString(actual.fg)}, wanted ${wanted.fg}`);
    }
    if (wanted.bg !== undefined && !colorMatches(actual.bg, wanted.bg)) {
        problems.push(`bg is ${colorToString(actual.bg)}, wanted ${wanted.bg}`);
    }
    for (const flag of ["bold", "dim", "italic", "underline", "inverse", "strikethrough"] as const) {
        if (wanted[flag] !== undefined && actual[flag] !== wanted[flag]) {
            problems.push(`${flag} is ${actual[flag]}, wanted ${wanted[flag]}`);
        }
    }
    return problems.join("; ");
}
