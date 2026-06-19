import fs from "fs";
import path from "path";
import winston from "winston";
import { inkTransport } from "./ink-transport";
import { LogMetadata, LogLevel, LogDetails } from "./types";
import { getCurrentTask } from "#base/task/taskContext";
import { getLogsPath } from "#utils/appPaths";

// Capture once at startup; ensure directory exists
const logsPath = getLogsPath();
fs.mkdirSync(path.dirname(logsPath), { recursive: true });
fs.writeFileSync(logsPath, "");

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
                        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
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

        if (level === LogLevel.ERROR) {
            Logger.logger.error(plainMessage, metadata);
        } else if (level === LogLevel.WARN) {
            Logger.logger.warn(plainMessage, metadata);
        } else if (level === LogLevel.DEBUG) {
            Logger.logger.debug(plainMessage, metadata);
        } else {
            Logger.logger.info(plainMessage, metadata);
        }
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
