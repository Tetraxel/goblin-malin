/**
 * A small Markdown reader for Claude's answers in the chat: headings, bullet and numbered lists, quotes, fenced code,
 * rules, and **bold** / *italic* / `code` / [link](url) inside a line. Not a full Markdown engine: the chat is a narrow
 * column, so only what Claude actually writes is read, and anything else shows as the text it is.
 *
 * Styling is written as SGR codes inside the text (`wrap-ansi` and Ink both carry them across wrapped lines). Only
 * attributes are used (bold, italic, underline, dim, inverse) and never a colour: a colour reset in the middle of a
 * line would drop the theme colour of the rest of it.
 */

const ESC = "\u001b";
const bold = (s: string): string => `${ESC}[1m${s}${ESC}[22m`;
const italic = (s: string): string => `${ESC}[3m${s}${ESC}[23m`;
const underline = (s: string): string => `${ESC}[4m${s}${ESC}[24m`;
const dim = (s: string): string => `${ESC}[2m${s}${ESC}[22m`;
const inverse = (s: string): string => `${ESC}[7m${s}${ESC}[27m`;

export type MdKind = "text" | "heading" | "bullet" | "code" | "quote" | "blank" | "rule" | "table";

/** A table: cells are styled text; every row has as many cells as the header. */
export type MdTable = {
    header: string[];
    rows: string[][];
    align: ("left" | "right" | "center")[];
};

/** One source line of an answer, read. */
export type MdLine = {
    kind: MdKind;
    /** The text, with styling codes. Empty for a blank line or a rule. */
    text: string;
    /** What stands before the first row of the line ("•", "2."); empty for none. */
    lead: string;
    /** Columns a nested list item is moved to the right. */
    nest: number;
    /** Columns the lead takes (its width and a space); 0 when there is no lead. */
    leadWidth: number;
    /** The table, for `kind: "table"`. */
    table?: MdTable;
};

const line = (kind: MdKind, text: string, lead = "", nest = 0): MdLine => ({
    kind,
    text,
    lead,
    nest,
    leadWidth: lead === "" ? 0 : lead.length + 1,
});

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** Inline styling of one piece of text outside of code spans. */
function styleSpans(text: string): string {
    return (
        text
            // [text](url) → underlined text, then the address.
            .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
                label === url ? underline(url) : `${underline(label)} ${dim(`(${url})`)}`
            )
            .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, (_m, inner: string) => bold(inner))
            .replace(/__(?=\S)(.+?)(?<=\S)__/g, (_m, inner: string) => bold(inner))
            .replace(/(?<![*\w])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![*\w])/g, (_m, inner: string) => italic(inner))
            .replace(/(?<![_\w])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![_\w])/g, (_m, inner: string) => italic(inner))
            .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, (_m, inner: string) => dim(inner))
    );
}

/**
 * The inline styling of a line. Code spans are set aside first, so that what is inside is left alone and emphasis
 * can wrap them (`**`name`**` is bold code, not stray stars around a chip).
 */
export function styleInline(text: string): string {
    const codes: string[] = [];
    const withoutCode = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_match, _fence: string, code: string) => {
        codes.push(code);
        // Private-use characters: nothing a model writes, and nothing the emphasis rules below look at.
        return `\uE000${codes.length - 1}\uE001`;
    });
    return styleSpans(withoutCode).replace(/\uE000(\d+)\uE001/g, (_match, index: string) =>
        inverse(codes[Number(index)] ?? "")
    );
}

/** The cells of one table line: the outer pipes are not cells, and `\|` is a pipe inside a cell. */
export function splitTableRow(raw: string): string[] {
    let text = raw.trim();
    if (text.startsWith("|")) text = text.slice(1);
    if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
    return text.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

const SEPARATOR_CELL = /^:?-+:?$/;

/** The line under a table's header: `| --- | :---: | ---: |`. */
function isTableSeparator(raw: string): boolean {
    if (!raw.includes("|") && !/^\s*:?-{3,}:?\s*$/.test(raw)) return false;
    const cells = splitTableRow(raw);
    return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

function readTable(lines: string[], at: number): { table: MdTable; next: number } | undefined {
    const header = lines[at];
    const separator = lines[at + 1];
    if (header === undefined || separator === undefined || !header.includes("|") || !isTableSeparator(separator)) {
        return undefined;
    }
    const heads = splitTableRow(header);
    const marks = splitTableRow(separator);
    if (heads.length < 1 || marks.length !== heads.length) return undefined;
    const align = marks.map((mark): MdTable["align"][number] =>
        mark.startsWith(":") && mark.endsWith(":") ? "center" : mark.endsWith(":") ? "right" : "left"
    );
    const rows: string[][] = [];
    let next = at + 2;
    while (next < lines.length && lines[next].includes("|") && lines[next].trim() !== "") {
        const cells = splitTableRow(lines[next]);
        rows.push(heads.map((_, c) => styleInline(cells[c] ?? "")));
        next++;
    }
    return { table: { header: heads.map((h) => styleInline(h.replace(/\*\*|__/g, ""))), rows, align }, next };
}

/** Reads an answer into lines. Unfinished Markdown (an answer still being written) shows as plain text until it closes. */
export function parseMarkdown(source: string): MdLine[] {
    const out: MdLine[] = [];
    let fence: string | undefined;
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    for (let at = 0; at < lines.length; at++) {
        const raw = lines[at];
        const fenceMatch = FENCE.exec(raw);
        if (fence !== undefined) {
            if (fenceMatch && fenceMatch[1] === fence) fence = undefined;
            else out.push(line("code", dim(raw.replace(/\t/g, "    "))));
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[1];
            continue;
        }
        if (raw.trim() === "") {
            // One blank line is enough between blocks.
            if (out.length > 0 && out[out.length - 1].kind !== "blank") out.push(line("blank", ""));
            continue;
        }
        const table = readTable(lines, at);
        if (table) {
            out.push({ ...line("table", ""), table: table.table });
            at = table.next - 1;
            continue;
        }
        if (RULE.test(raw)) {
            out.push(line("rule", ""));
            continue;
        }
        const heading = HEADING.exec(raw);
        if (heading) {
            out.push(line("heading", bold(styleInline(heading[1].replace(/\*\*|__/g, "")))));
            continue;
        }
        const bullet = BULLET.exec(raw);
        if (bullet) {
            const nest = Math.min(6, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2) * 2);
            out.push(line("bullet", styleInline(bullet[2]), nest === 0 ? "•" : "◦", nest));
            continue;
        }
        const numbered = NUMBERED.exec(raw);
        if (numbered) {
            const nest = Math.min(6, Math.floor(numbered[1].replace(/\t/g, "  ").length / 2) * 2);
            out.push(line("bullet", styleInline(numbered[3]), `${numbered[2]}.`, nest));
            continue;
        }
        const quote = QUOTE.exec(raw);
        if (quote) {
            out.push(line("quote", dim(styleInline(quote[1])), "▎"));
            continue;
        }
        out.push(line("text", styleInline(raw.trim())));
    }
    while (out.length > 0 && out[out.length - 1].kind === "blank") out.pop();
    return out;
}

/** The text of a line without its styling codes. */
export function stripStyle(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*m/g, "");
}
