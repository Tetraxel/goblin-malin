import { inspect } from "util";
import stripAnsi from "strip-ansi";
import cliTruncate from "cli-truncate";
import wrapAnsi from "wrap-ansi";
import { LogDetails, LogLevel, LogMetadata } from "#base/logger/types";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { sanitizeInput } from "#utils/string";

export type LogRowKind = "header" | "message" | "detail";

export interface LogSegment {
    text: string;
    color?: string;
    dim?: boolean;
}

export interface LogRow {
    /** Styled segments that make up one terminal line. */
    segments: LogSegment[];
    level: LogLevel;
    kind: LogRowKind;
    /** Stable key for React (logId + row index). */
    key: string;
}

// Max visible chars for the truncated task URI column.
const URI_BUDGET = 14;

export function levelColor(level: LogLevel): string | undefined {
    switch (level) {
        case LogLevel.WARN:
            return "yellow";
        case LogLevel.ERROR:
            return "red";
        case LogLevel.DEBUG:
            return "gray";
        case LogLevel.INFO:
            return "blue";
        default:
            return undefined;
    }
}

function pad2(n: number): string {
    return n.toString().padStart(2, "0");
}

/** Strip ANSI escapes, control chars, expand tabs. */
function clean(s: string): string {
    return sanitizeInput(stripAnsi(s).replace(/\t/g, "    "));
}

function formatDetailRows(
    details: LogDetails | undefined,
    indent: string,
    level: LogLevel,
    keyBase: string,
    width: number
): LogRow[] {
    if (!details || Object.keys(details).length === 0) return [];
    // Details stay white for INFO — only message rows use blue.
    const color = level === LogLevel.INFO ? undefined : levelColor(level);
    const inspected = inspect(details, {
        depth: null,
        colors: false,
        compact: false,
        breakLength: Math.max(20, width - indent.length - 2),
    });
    return inspected.split("\n").map((line, i) => ({
        segments: [{ text: indent + (i === 0 ? "└ " : "  ") + clean(line), color, dim: true }],
        level,
        kind: "detail" as LogRowKind,
        key: `${keyBase}:d${i}`,
    }));
}

/**
 * Turn a single log entry into the visual rows it occupies in the log panel.
 *
 * Format:  HH:MM:SS  LEVEL  URI…  flow  service  message
 * Colors:  gray/dim  level  cyan  level  level    level
 */
export function formatLogRows(log: LogMetadata, width: number): LogRow[] {
    const level = log.level as LogLevel;
    const color = levelColor(level);
    const keyBase = log.id;

    // Timestamp: "HH:MM:SS "
    const ts = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp as string);
    const tsText = `${pad2(ts.getHours())}:${pad2(ts.getMinutes())}:${pad2(ts.getSeconds())} `;

    // Level: 5 chars padded, no brackets — "DEBUG", "INFO ", "WARN ", "ERROR"
    const levelText = level.padEnd(5) + " ";

    // Get task attrs once for both uri display and brand color.
    const attrs = log.task?.getAttributes?.() as
        | { uri?: { platform: string; type: string; id: string }; recognizedServiceKey?: string }
        | undefined;
    const recognizedServiceKey = attrs?.recognizedServiceKey;
    const serviceDisplay = recognizedServiceKey ? providerDisplayRegistry.get(recognizedServiceKey) : null;
    const uriColor = serviceDisplay ? serviceDisplay.color : "cyan";

    // URI: always "ACRONYM:id" — e.g. "YT:dlr8ale…", "SP:4rye8zg…".
    // Falls back to the raw log label (URL) for unrecognized inputs.
    let uriDisplay: string | undefined;
    if (attrs?.uri && serviceDisplay) {
        uriDisplay = `${serviceDisplay.acronym}:${attrs.uri.id.toLowerCase()}`;
    } else {
        const rawLabel = log.task?.getLogLabel?.();
        if (rawLabel) uriDisplay = rawLabel;
    }
    const uriText = uriDisplay ? cliTruncate(clean(uriDisplay), URI_BUDGET, { position: "end" }) + " " : "";

    // Flow / service: no brackets
    const flowText = log.flow ? clean(String(log.flow)) + " " : "";
    const serviceText = log.service ? clean(String(log.service)) + " " : "";

    // Indent for continuation / detail rows — aligns under the message start.
    const indent = " ".repeat(tsText.length + levelText.length + uriText.length);

    // Message body — split on explicit newlines, then soft-wrap each segment.
    // Subtract 2 for row paddingX (1 each side). First segment has less room
    // because the full prefix (ts+level+uri+flow+service) precedes it.
    const rawMsg = typeof log.message === "string" ? log.message : String(log.message ?? "");
    const lineWidth = Math.max(10, width - 2);
    const prefixLen = tsText.length + levelText.length + uriText.length + flowText.length + serviceText.length;
    const allMsgLines: string[] = rawMsg.split("\n").flatMap((segment, segIdx) => {
        const cleaned = clean(segment);
        const maxW = segIdx === 0 ? Math.max(10, lineWidth - prefixLen) : Math.max(10, lineWidth - indent.length);
        return wrapAnsi(cleaned, maxW, { hard: true, trim: false }).split("\n");
    });

    const rows: LogRow[] = [];

    // Header row
    const segments: LogSegment[] = [
        { text: tsText, color: "gray", dim: true },
        { text: levelText, color },
    ];
    if (uriText) segments.push({ text: uriText, color: uriColor });
    if (flowText) segments.push({ text: flowText, color: "white" });
    if (serviceText) segments.push({ text: serviceText, color: "white" });
    segments.push({ text: allMsgLines[0] ?? "", color });

    rows.push({ segments, level, kind: "header", key: `${keyBase}:h0` });

    // Continuation rows (soft-wrapped and explicit newlines)
    allMsgLines.slice(1).forEach((line, i) => {
        rows.push({
            segments: [{ text: indent + line, color }],
            level,
            kind: "message",
            key: `${keyBase}:m${i}`,
        });
    });

    // Detail rows
    rows.push(...formatDetailRows(log.details, indent, level, keyBase, width));

    return rows;
}
