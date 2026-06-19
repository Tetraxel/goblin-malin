import { inspect } from "util";
import stripAnsi from "strip-ansi";
import wrapAnsi from "wrap-ansi";
import cliTruncate from "cli-truncate";
import { LogDetails, LogLevel, LogMetadata } from "#base/logger/types";
import { sanitizeInput } from "#utils/string";

export type LogRowKind = "header" | "message" | "detail";

export interface LogRow {
    /** A single visual line, already sanitized and width-wrapped. */
    text: string;
    level: LogLevel;
    kind: LogRowKind;
    /** Stable key for React (logId + row index). */
    key: string;
}

// Width budget for the truncated uri/url prefix.
const PREFIX_BUDGET = 24;

/** Strip ANSI escapes (their ESC byte is itself a control char), then any
 * remaining control chars, and expand tabs so the terminal grid stays intact. */
function clean(line: string): string {
    return sanitizeInput(stripAnsi(line).replace(/\t/g, "    "));
}

/** Width-aware wrap (word wrap + hard slicing of long tokens). Always ≥1 row. */
function wrap(text: string, width: number): string[] {
    if (width <= 0) return [text];
    const wrapped = wrapAnsi(text, width, { hard: true, trim: false });
    const lines = wrapped.split("\n");
    return lines.length > 0 ? lines : [""];
}

function formatDetailRows(details: LogDetails | undefined, width: number, level: LogLevel, keyBase: string): LogRow[] {
    if (!details || Object.keys(details).length === 0) return [];

    const inspected = inspect(details, {
        depth: null,
        colors: false,
        compact: false,
        breakLength: Math.max(20, width - 2),
    });

    const rows: LogRow[] = [];
    inspected.split("\n").forEach((line, lineIdx) => {
        const prefix = lineIdx === 0 ? "└ " : "  ";
        wrap(prefix + clean(line), width).forEach((text, wrapIdx) => {
            rows.push({ text, level, kind: "detail", key: `${keyBase}:d${lineIdx}.${wrapIdx}` });
        });
    });
    return rows;
}

/**
 * Turn a single log entry into the visual rows it occupies in the log panel.
 * The first row carries the `[LEVEL] [uri] [flow] [service] message` header;
 * subsequent rows are wrapped message continuations and inspected `details`.
 */
export function formatLogRows(log: LogMetadata, width: number): LogRow[] {
    const level = log.level;
    const keyBase = log.id;

    // Prefix tokens
    const tokens = [`[${level}]`];
    const label = log.task?.getLogLabel?.();
    if (label) tokens.push(`[${cliTruncate(clean(label), PREFIX_BUDGET, { position: "end" })}]`);
    if (log.flow) tokens.push(`[${clean(String(log.flow))}]`);
    if (log.service) tokens.push(`[${clean(String(log.service))}]`);
    const prefix = tokens.join(" ");

    // Message (may itself contain newlines)
    const rawMessage = typeof log.message === "string" ? log.message : String(log.message ?? "");
    const messageLines = rawMessage.split("\n").map(clean);

    const rows: LogRow[] = [];
    const firstLine = `${prefix} ${messageLines[0] ?? ""}`.trimEnd();
    wrap(firstLine, width).forEach((text, i) => {
        rows.push({ text, level, kind: i === 0 ? "header" : "message", key: `${keyBase}:h${i}` });
    });

    messageLines.slice(1).forEach((line, lineIdx) => {
        wrap(line, width).forEach((text, wrapIdx) => {
            rows.push({ text, level, kind: "message", key: `${keyBase}:m${lineIdx}.${wrapIdx}` });
        });
    });

    rows.push(...formatDetailRows(log.details, width, level, keyBase));
    return rows;
}
