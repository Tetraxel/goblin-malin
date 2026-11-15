import wrapAnsi from "wrap-ansi";
import { type ChatMessage } from "#flows/musicDownloadFlow/agent/chatStore";
import { parseMarkdown } from "./markdown";
import { layoutTable } from "./tableLayout";

/** One line of the chat as drawn: a fixed-width marker, a lead (list bullet), then the text. */
export type ChatRow = {
    key: string;
    role: ChatMessage["role"];
    /** The marker of the first line of a message ("›", "✓"…); empty on its continuation lines. */
    marker: string;
    /** The text, which may carry styling codes (an answer is Markdown). */
    text: string;
    state?: ChatMessage["state"];
    /** The first line of its message (a gap goes above it, except for the first message). */
    first: boolean;
    /** What stands before the text on the first row of a list item or quote ("•", "2."); empty otherwise. */
    lead: string;
    /** Columns a nested list item is moved to the right (the lead moves with it). */
    nest: number;
    /** Columns taken between the marker and the text: the nesting, the lead and its space. */
    indent: number;
    /** A horizontal rule: drawn across the text's width, `text` is empty. */
    rule: boolean;
    /** Drawn dimmed: the raw call and answer under an opened tool line. */
    dim: boolean;
    /** The tool line this row belongs to: a click on it opens or closes the details. */
    toggleId: number | undefined;
};

/** Columns the marker takes (a symbol and a space). */
export const MARKER_WIDTH = 2;

const MARKERS: Record<ChatMessage["role"], string> = {
    user: "›",
    assistant: "",
    tool: "⚙",
    note: "·",
    error: "✗",
};

/** The text of one message cut into lines no wider than `width` (a word longer than a line is cut). */
export function wrapMessage(text: string, width: number): string[] {
    const limit = Math.max(1, width);
    return wrapAnsi(text, limit, { hard: true, trim: true }).split("\n");
}

type Piece = Pick<ChatRow, "text" | "lead" | "nest" | "indent" | "rule"> & Partial<Pick<ChatRow, "dim" | "toggleId">>;

const plain = (text: string): Piece => ({ text, lead: "", nest: 0, indent: 0, rule: false });

/** The most of a call's input or answer shown when opened: the rest is in the message, cut for the screen. */
const DETAIL_VIEW_CHARS = 1500;

const clip = (text: string): string =>
    text.length > DETAIL_VIEW_CHARS
        ? `${text.slice(0, DETAIL_VIEW_CHARS)}… (${text.length - DETAIL_VIEW_CHARS} more)`
        : text;

/**
 * A tool line: its label, and when opened what Claude sent (→) and what the tool answered (←), raw. A line with
 * details starts with ▸ (closed) or ▾ (open).
 */
function toolPieces(message: ChatMessage, room: number): Piece[] {
    const toggleId = message.detail ? message.id : undefined;
    const arrow = message.detail ? (message.expanded ? "▾ " : "▸ ") : "";
    const pieces: Piece[] = wrapMessage(arrow + message.text, room).map((text) => ({ ...plain(text), toggleId }));
    if (!message.expanded || !message.detail) return pieces;
    const add = (lead: string, raw: string): void => {
        const lines = wrapAnsi(clip(raw), Math.max(1, room - 3), { hard: true, trim: false }).split("\n");
        lines.forEach((text, i) =>
            pieces.push({ text, lead: i === 0 ? lead : "", nest: 0, indent: 3, rule: false, dim: true, toggleId })
        );
    };
    add("→", message.detail.input === "" ? "{}" : message.detail.input);
    add("←", message.detail.output ?? "(no answer yet)");
    return pieces;
}

/** What a message of the user shows: its text between a blank row above and below, which carry the background. */
const userPieces = (text: string, room: number): Piece[] => [
    plain(""),
    ...wrapMessage(text, room).map(plain),
    plain(""),
];

/** What an answer shows: its Markdown read, each line wrapped under its own lead. */
function answerPieces(text: string, width: number): Piece[] {
    const pieces: Piece[] = [];
    for (const md of parseMarkdown(text)) {
        if (md.kind === "blank") {
            pieces.push(plain(""));
            continue;
        }
        if (md.kind === "rule") {
            pieces.push({ text: "", lead: "", nest: 0, indent: 0, rule: true });
            continue;
        }
        if (md.kind === "table" && md.table) {
            for (const row of layoutTable(md.table, width)) {
                pieces.push({ text: row.text, lead: row.lead, nest: 0, indent: row.indent, rule: false });
            }
            continue;
        }
        const indent = md.nest + md.leadWidth;
        const room = Math.max(1, width - indent);
        // Code keeps its own spaces; everything else is tidied where it wraps.
        const wrapped = wrapAnsi(md.text, room, { hard: true, trim: md.kind !== "code" }).split("\n");
        wrapped.forEach((chunk, i) => {
            pieces.push({ text: chunk, lead: i === 0 ? md.lead : "", nest: md.nest, indent, rule: false });
        });
    }
    return pieces.length > 0 ? pieces : [plain("")];
}

// A message is wrapped once per width: a streaming answer re-wraps only itself. Keyed by the message object, not by
// its id and lengths: the store never changes a message in place (a change makes a new object), and ids are reused
// by another conversation (`/new`, a restored one), so an id-based key would give one message another's rows.
const rowCache = new WeakMap<ChatMessage, Map<number, ChatRow[]>>();
// The rows a message had last time, so a line that did not change keeps the very same object: the rows are
// memoized components, and an answer being written changes its last line, not the 30 above it.
const lastRows = new Map<number, ChatRow[]>();
const gapRows = new Map<number, ChatRow>();
const MAX_CACHE = 2000;

/** The rows of one message at this width. */
export function formatMessage(message: ChatMessage, width: number): ChatRow[] {
    const byWidth = rowCache.get(message) ?? new Map<number, ChatRow[]>();
    rowCache.set(message, byWidth);
    const cached = byWidth.get(width);
    if (cached) return cached;
    const room = Math.max(1, width - MARKER_WIDTH);
    const pieces =
        message.role === "assistant"
            ? answerPieces(message.text, room)
            : message.role === "tool"
              ? toolPieces(message, room)
              : message.role === "user"
                ? userPieces(message.text, room)
                : wrapMessage(message.text, room).map(plain);
    // The marker goes on the first row of text (a message of the user has a blank row above it).
    const markerRow = message.role === "user" ? 1 : 0;
    const previous = lastRows.get(message.id);
    const rows = pieces.map((piece, i): ChatRow => {
        const marker = i === markerRow ? MARKERS[message.role] : "";
        const before = previous?.[i];
        if (
            before &&
            before.text === piece.text &&
            before.marker === marker &&
            before.state === message.state &&
            before.lead === piece.lead &&
            before.nest === piece.nest &&
            before.indent === piece.indent &&
            before.rule === piece.rule &&
            before.dim === (piece.dim ?? false) &&
            before.toggleId === piece.toggleId
        ) {
            return before;
        }
        return {
            key: `${message.id}.${i}`,
            role: message.role,
            marker,
            state: message.state,
            first: i === 0,
            ...piece,
            dim: piece.dim ?? false,
            toggleId: piece.toggleId,
        };
    });
    if (lastRows.size > MAX_CACHE) {
        lastRows.clear();
        gapRows.clear();
    }
    byWidth.set(width, rows);
    lastRows.set(message.id, rows);
    return rows;
}

/** Every row of the conversation, with one blank row between messages of different kinds of speaker. */
export function formatChatRows(messages: readonly ChatMessage[], width: number): ChatRow[] {
    const rows: ChatRow[] = [];
    messages.forEach((message, i) => {
        const prev = messages[i - 1];
        // A tool line stays next to the tool lines around it; everything else is set apart.
        const gap =
            prev &&
            !(prev.role === "tool" && message.role === "tool") &&
            !(prev.role === "note" && message.role === "note");
        if (gap) {
            let row = gapRows.get(message.id);
            if (!row) {
                row = {
                    key: `gap.${message.id}`,
                    // Neutral: the gap above a message of the user must not carry that message's background.
                    role: "note",
                    marker: "",
                    text: "",
                    first: false,
                    lead: "",
                    nest: 0,
                    indent: 0,
                    rule: false,
                    dim: false,
                    toggleId: undefined,
                };
                gapRows.set(message.id, row);
            }
            rows.push(row);
        }
        rows.push(...formatMessage(message, width));
    });
    return rows;
}

/** The rows to show: the last `height`, or the ones `scroll` rows further back. */
export function visibleRows(rows: readonly ChatRow[], height: number, scroll: number): ChatRow[] {
    const end = Math.max(0, rows.length - Math.max(0, scroll));
    return rows.slice(Math.max(0, end - height), end);
}

/** How far back the conversation can be scrolled. */
export function maxScroll(rowCount: number, height: number): number {
    return Math.max(0, rowCount - height);
}

/**
 * What "copy" takes: Claude's last answer, as written (Markdown). An answer is cut in pieces by the tool lines in
 * between, so it is everything Claude said since the last message of the user.
 */
export function lastAnswer(messages: readonly ChatMessage[]): string {
    let start = messages.length;
    while (start > 0 && messages[start - 1].role !== "user") start--;
    const since = messages.slice(start).filter((m) => m.role === "assistant");
    if (since.length > 0) return since.map((m) => m.text.trim()).join("\n\n");
    // Nothing since the user spoke: the last thing Claude said before it.
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last ? last.text.trim() : "";
}
