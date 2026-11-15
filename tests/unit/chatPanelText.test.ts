import { describe, expect, test } from "vitest";
import { parseMarkdown, stripStyle, styleInline } from "#components/ChatPanel/markdown";
import { formatMessage, lastAnswer } from "#components/ChatPanel/formatChat";
import {
    cursorRow,
    firstVisibleRow,
    inputRowCount,
    layoutInput,
    rowStarts,
    sanitizeTyped,
} from "#components/ChatPanel/inputLayout";
import {
    CHAT_PANEL_MAX_WIDTH,
    CHAT_PANEL_MIN_WIDTH,
    CHAT_PANEL_WIDTH,
    clampChatWidth,
    maxChatWidth,
} from "#components/ChatPanel/chatPanelState";
import { MIN_TERMINAL_WIDTH } from "#utils/terminalSize";

const ESC = "\u001b";
const message = (id: number, role: "user" | "assistant" | "tool", text: string) => ({ id, role, text });

describe("the rows of a message", () => {
    test("another message with the same id, text length and width gets its own rows", () => {
        // A conversation restored after /new reuses ids: the cache must not hand back the first one's text.
        const first = formatMessage(message(77, "assistant", "aaaa bbbb"), 40);
        const second = formatMessage(message(77, "assistant", "cccc dddd"), 40);
        expect(first.map((r) => r.text)).toEqual(["aaaa bbbb"]);
        expect(second.map((r) => r.text)).toEqual(["cccc dddd"]);
        // The same message object at the same width is wrapped once.
        const same = message(78, "assistant", "x y z");
        expect(formatMessage(same, 40)).toBe(formatMessage(same, 40));
    });
});

describe("Markdown in an answer", () => {
    test("emphasis and code become styling, and the marks disappear", () => {
        expect(styleInline("a **bold** word")).toBe(`a ${ESC}[1mbold${ESC}[22m word`);
        expect(styleInline("an *italic* one")).toBe(`an ${ESC}[3mitalic${ESC}[23m one`);
        expect(styleInline("run `yarn test` now")).toBe(`run ${ESC}[7myarn test${ESC}[27m now`);
        expect(stripStyle(styleInline("**a** and `b` and [c](https://x.y)"))).toBe("a and b and c (https://x.y)");
    });

    test("emphasis can wrap a code span: bold code is bold code, with no stray stars", () => {
        const styled = styleInline("- **`musicbrainz_lookup`** accepte, *`x`* aussi");
        expect(stripStyle(styled)).toBe("- musicbrainz_lookup accepte, x aussi");
        expect(styled).toContain(`${ESC}[1m${ESC}[7mmusicbrainz_lookup${ESC}[27m${ESC}[22m`);
        expect(styleInline("`a` and `b`")).toBe(`${ESC}[7ma${ESC}[27m and ${ESC}[7mb${ESC}[27m`);
        expect(styleInline("`` a`b ``")).toBe(`${ESC}[7m a\`b ${ESC}[27m`);
    });

    test("what is inside a code span is left alone", () => {
        expect(stripStyle(styleInline("`**not bold**` and `a * b * c`"))).toBe("**not bold** and a * b * c");
    });

    test("a lone star, a snake_case name and a product of numbers are not emphasis", () => {
        expect(styleInline("2 * 3 * 4")).toBe("2 * 3 * 4");
        expect(styleInline("my_file_name")).toBe("my_file_name");
        expect(styleInline("an **unfinished")).toBe("an **unfinished");
    });

    test("headings, lists, quotes, rules and fenced code are read line by line", () => {
        const lines = parseMarkdown(
            [
                "## Title",
                "",
                "- one",
                "  - nested",
                "2. two",
                "> quoted",
                "---",
                "```ts",
                "const x = 1;",
                "```",
                "end",
            ].join("\n")
        );
        expect(lines.map((l) => l.kind)).toEqual([
            "heading",
            "blank",
            "bullet",
            "bullet",
            "bullet",
            "quote",
            "rule",
            "code",
            "text",
        ]);
        expect(lines.map((l) => l.lead)).toEqual(["", "", "•", "◦", "2.", "▎", "", "", ""]);
        expect(lines[3].nest).toBe(2);
        expect(stripStyle(lines[0].text)).toBe("Title");
        expect(stripStyle(lines[7].text)).toBe("const x = 1;");
    });

    test("blank lines do not pile up and the answer does not end on one", () => {
        expect(parseMarkdown("a\n\n\n\nb\n\n").map((l) => l.kind)).toEqual(["text", "blank", "text"]);
    });

    test("an answer wraps under its bullet, and the bullet is not part of the text", () => {
        const rows = formatMessage(message(900, "assistant", "- one two three four five six seven eight"), 24);
        expect(rows.length).toBeGreaterThan(1);
        expect(rows[0].lead).toBe("•");
        expect(rows.slice(1).every((r) => r.lead === "")).toBe(true);
        expect(rows.every((r) => r.indent === 2)).toBe(true);
        expect(rows.map((r) => stripStyle(r.text)).join(" ")).toBe("one two three four five six seven eight");
        // 24 columns, minus the marker and the bullet.
        expect(rows.every((r) => stripStyle(r.text).length <= 24 - 2 - 2)).toBe(true);
    });

    test("only the answers are read as Markdown: what the user types stays as typed", () => {
        const rows = formatMessage(message(901, "user", "**keep** - this"), 40);
        expect(rows.map((r) => r.text)).toEqual(["", "**keep** - this", ""]);
    });
});

describe("tables in an answer", () => {
    const source = [
        "| Tool | Kind |",
        "|---|:-:|",
        "| `list_tasks` | **read** |",
        "| `set_override` | write |",
        "",
        "after",
    ].join("\n");

    test("a table is read as one block with a header, rows and alignment", () => {
        const lines = parseMarkdown(source);
        expect(lines.map((l) => l.kind)).toEqual(["table", "blank", "text"]);
        const table = lines[0].table!;
        expect(table.header.map(stripStyle)).toEqual(["Tool", "Kind"]);
        expect(table.rows.map((r) => r.map(stripStyle))).toEqual([
            ["list_tasks", "read"],
            ["set_override", "write"],
        ]);
        expect(table.align).toEqual(["left", "center"]);
    });

    test("a line with a pipe that is not followed by a separator is only text", () => {
        expect(parseMarkdown("a | b\nnot a table").map((l) => l.kind)).toEqual(["text", "text"]);
        expect(parseMarkdown("a | b\n---").map((l) => l.kind)).toEqual(["text", "rule"]);
    });

    test("a table that fits is drawn as a grid of the same width on every line", () => {
        const rows = formatMessage(message(910, "assistant", source), 40);
        const grid = rows.filter((r) => /[│┌├└]/.test(stripStyle(r.text))).map((r) => stripStyle(r.text));
        expect(grid[0]).toMatch(/^┌─+┬─+┐$/);
        expect(grid.some((l) => l.includes("│ Tool") && l.includes("Kind"))).toBe(true);
        expect(grid[grid.length - 1]).toMatch(/^└─+┴─+┘$/);
        expect(new Set(grid.map((l) => l.length)).size).toBe(1);
        expect(grid[0].length).toBeLessThanOrEqual(40 - 2);
    });

    test("a table too wide for the panel becomes one card per row, nothing is lost", () => {
        const wide = [
            "| Tool | Resource | What I get |",
            "|---|---|---|",
            "| list_tasks | Tasks (tracks, albums, playlists) | id, title, artists, state |",
        ].join("\n");
        const rows = formatMessage(message(911, "assistant", wide), 30);
        const text = rows.map((r) => stripStyle(r.text)).join(" ");
        expect(rows.some((r) => r.lead === "▪")).toBe(true);
        expect(text).toContain("list_tasks");
        expect(text).toContain("Resource:");
        expect(text).toContain("What I get:");
        expect(text).not.toMatch(/[│┌]/);
        expect(rows.every((r) => stripStyle(r.text).length <= 30 - 2 - r.indent)).toBe(true);
    });

    test("a cell with a long text wraps inside its column", () => {
        const long = ["| A | B |", "|---|---|", `| x | ${"word ".repeat(30)} |`].join("\n");
        const rows = formatMessage(message(912, "assistant", long), 50);
        const grid = rows.map((r) => stripStyle(r.text));
        expect(grid.length).toBeGreaterThan(6);
        expect(new Set(grid.map((l) => l.length)).size).toBe(1);
        expect(grid.join("").match(/word/g)).toHaveLength(30);
    });
});

describe("copying Claude's answer", () => {
    test("is everything Claude said since the user last spoke, as written", () => {
        const messages = [
            message(1, "user", "hi"),
            message(2, "assistant", "old answer"),
            message(3, "user", "fix it"),
            message(4, "assistant", "I looked at it.\n"),
            message(5, "tool", "get_task a"),
            message(6, "assistant", "- **Done**"),
        ];
        expect(lastAnswer(messages)).toBe("I looked at it.\n\n- **Done**");
    });

    test("falls back to the last answer when Claude has not answered yet, and to nothing", () => {
        expect(lastAnswer([message(1, "assistant", "earlier"), message(2, "user", "and?")])).toBe("earlier");
        expect(lastAnswer([message(1, "user", "hello")])).toBe("");
        expect(lastAnswer([])).toBe("");
    });
});

describe("the text line", () => {
    test("wraps at the width and keeps a row for the cursor", () => {
        expect(rowStarts(Array.from("abcdef"), 4)).toEqual([0, 4]);
        // Exactly full: the cursor needs a row of its own.
        expect(rowStarts(Array.from("abcd"), 4)).toEqual([0, 4]);
        expect(rowStarts(Array.from("abc"), 4)).toEqual([0]);
        expect(rowStarts([], 4)).toEqual([0]);
    });

    test("breaks after a space so a word is not cut, unless the word is longer than a row", () => {
        // "hello " (6) fits in 10, "world" would end at 11: it moves down whole.
        expect(rowStarts(Array.from("hello world foo"), 10)).toEqual([0, 6]);
        expect(layoutInput("hello world foo", 15, 10).map((r) => r.before + r.cursor + r.after)).toEqual([
            "hello ",
            "world foo ",
        ]);
        expect(rowStarts(Array.from("a verylongwordthatcannotfit"), 10)).toEqual([0, 2, 12, 22]);
    });

    test("wide characters take two columns", () => {
        // Two wide characters fill a 4-column row; the third starts the next one, which still has room for the cursor.
        expect(rowStarts(Array.from("日本語"), 4)).toEqual([0, 2]);
        // A wide character that does not fit in what is left of a row starts the next row.
        expect(rowStarts(Array.from("abc日"), 4)).toEqual([0, 3]);
    });

    test("the cursor row, and the rows that are shown", () => {
        const starts = [0, 4, 8, 12, 16, 20];
        expect(cursorRow(starts, 0)).toBe(0);
        expect(cursorRow(starts, 4)).toBe(1);
        expect(cursorRow(starts, 19)).toBe(4);
        expect(firstVisibleRow(6, 5, 4)).toBe(2);
        expect(firstVisibleRow(6, 0, 4)).toBe(0);
        expect(firstVisibleRow(2, 1, 4)).toBe(0);
    });

    test("a long text grows the line to its maximum, then scrolls with the cursor", () => {
        const long = "x".repeat(100);
        expect(inputRowCount("", 10)).toBe(1);
        expect(inputRowCount("x".repeat(15), 10)).toBe(2);
        expect(inputRowCount(long, 10)).toBe(4);

        const atEnd = layoutInput(long, 100, 10);
        expect(atEnd).toHaveLength(4);
        expect(atEnd[3]).toEqual({ before: "", cursor: " ", after: "" });
        const atStart = layoutInput(long, 0, 10);
        expect(atStart[0]).toEqual({ before: "", cursor: "x", after: "x".repeat(9) });
        expect(atStart).toHaveLength(4);
        // Whatever the cursor does, no row is wider than the line.
        for (const cursor of [0, 7, 10, 55, 100]) {
            for (const row of layoutInput(long, cursor, 10)) {
                expect(Array.from(row.before + row.cursor + row.after).length).toBeLessThanOrEqual(10);
            }
        }
    });

    test("the cursor sits on the character it will insert before", () => {
        expect(layoutInput("hello", 2, 20)).toEqual([{ before: "he", cursor: "l", after: "lo" }]);
        expect(layoutInput("hello", 5, 20)).toEqual([{ before: "hello", cursor: " ", after: "" }]);
    });

    test("typed and pasted text is one line without control characters", () => {
        expect(sanitizeTyped("a\r\nb\tc\u0007d")).toBe("a b cd");
    });
});

describe("the panel's width", () => {
    test("stays between its smallest and the room the terminal leaves for the task list", () => {
        expect(clampChatWidth(10, 200)).toBe(CHAT_PANEL_MIN_WIDTH);
        expect(clampChatWidth(500, 400)).toBe(CHAT_PANEL_MAX_WIDTH);
        expect(clampChatWidth(80, 200)).toBe(80);
        // A narrower terminal keeps the task list at its smallest layout.
        expect(maxChatWidth(120)).toBe(120 - MIN_TERMINAL_WIDTH);
        expect(clampChatWidth(100, 120)).toBe(120 - MIN_TERMINAL_WIDTH);
        expect(clampChatWidth(CHAT_PANEL_WIDTH, MIN_TERMINAL_WIDTH + CHAT_PANEL_WIDTH)).toBe(CHAT_PANEL_WIDTH);
    });
});
