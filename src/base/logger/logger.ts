import fs from "fs";
import path from "path";
import winston from "winston";
import { inkTransport } from "./ink-transport";
import { toLoggable } from "./serialize";
import { type LogMetadata, LogLevel, type LogDetails } from "./types";
import { getCurrentTask } from "#base/task/taskContext";
import { getLogsPath } from "#utils/appPaths";

// Cap for the log file within one session (winston rotates to a second file when it is reached).
const MAX_LOG_BYTES = 10 * 1024 * 1024;

// Capture once at startup; ensure directory exists
const logsPath = getLogsPath();
fs.mkdirSync(path.dirname(logsPath), { recursive: true });
rotatePreviousLog(logsPath);

/**
 * Keep the previous session's log (the one you want after a crash) as `app.prev.log` instead of
 * truncating it at start. Never throws: if the rename fails (the file is held by another process),
 * the new session simply appends to the existing file.
 */
function rotatePreviousLog(file: string): void {
    try {
        if (!fs.existsSync(file) || fs.statSync(file).size === 0) return;
        const { dir, name, ext } = path.parse(file);
        fs.renameSync(file, path.join(dir, `${name}.prev${ext}`));
    } catch {
        // appending beats losing the log or failing to start
    }
}

// The file gets plain data: a task as { taskId, label }, an Error as { name, message, stack } (DATA-10).
const toPlainData = winston.format((info) => {
    const { task, details, ...rest } = info as typeof info & { task?: unknown; details?: unknown };
    const out: Record<string, unknown> = { ...rest };
    if (task) out.task = toLoggable(task);
    if (details !== undefined) out.details = toLoggable(details);
    return out as unknown as typeof info;
});

function getString(obj: unknown): string {
    if (typeof obj === "string") {
        return obj;
    } else if (obj instanceof Error) {
        return obj.message;
    } else {
        return JSON.stringify(obj);
    }
}

export class Logger {
    private static logger: winston.Logger;
    public metadata: Partial<LogMetadata> = {};

    constructor({
        metadata,
        parentLogger,
    }: {
        metadata?: Partial<LogMetadata>;
        parentLogger?: Logger;
    } = {}) {
        if (!Logger.logger) {
            Logger.logger = winston.createLogger({
                transports: [
                    inkTransport,
                    // Combined log file
                    new winston.transports.File({
                        filename: logsPath,
                        level: "debug",
                        format: winston.format.combine(
                            toPlainData(),
                            winston.format.timestamp(),
                            winston.format.json()
                        ),
                        maxsize: MAX_LOG_BYTES,
                        maxFiles: 2,
                        tailable: true,
                    }),
                ],
            });
        }

        this.metadata = {};
        if (parentLogger) {
            this.metadata = { ...this.metadata, ...parentLogger.metadata };
        }
        if (metadata) this.metadata = { ...this.metadata, ...metadata };
    }

    private log(level: LogLevel, message: unknown, details: LogDetails = {}) {
        // Store the plain message. Presentation (level color, [service] prefix,
        // uri prefix) is applied by the log panel at render time so the on-disk
        // log stays free of ANSI escapes and width math is accurate.
        const plainMessage = getString(message);

        // Attribute to the explicitly-bound task, else the ambient task context
        // (set by @TaskScoped) so shared code logs land under the right task.
        const task = this.metadata?.task ?? getCurrentTask();

        const metadata: Omit<LogMetadata, "message"> = {
            ...this.metadata,
            task,
            id: crypto.randomUUID(),
            timestamp: new Date(),
            level,
            details,
        };

        // The single-object form, never `logger.error(message, metadata)`: when the message holds a format token
        // (`%s`, as a React warning does) winston takes the second argument for a value to format and drops the
        // metadata, so the entry reached the log panel with no id and no time (every row got the same key, which React
        // warned about, which was logged with a `%s`, which...).
        const winstonLevel =
            level === LogLevel.ERROR
                ? "error"
                : level === LogLevel.WARN
                  ? "warn"
                  : level === LogLevel.DEBUG
                    ? "debug"
                    : "info";
        Logger.logger.log({ ...metadata, level: winstonLevel, message: plainMessage });
    }

    public info(message: unknown, details?: LogDetails) {
        this.log(LogLevel.INFO, message, details);
    }

    public warn(message: unknown, details?: LogDetails) {
        this.log(LogLevel.WARN, message, details);
    }

    public error(message: unknown, details?: LogDetails) {
        this.log(LogLevel.ERROR, message, details);
    }

    public debug(message: unknown, details?: LogDetails) {
        this.log(LogLevel.DEBUG, message, details);
    }

    // Create a child logger with additional metadata
    public createChild(additionalMetadata: Partial<LogMetadata>): Logger {
        return new Logger({
            metadata: additionalMetadata,
            parentLogger: this,
        });
    }
}

export const globalLogger = new Logger();
