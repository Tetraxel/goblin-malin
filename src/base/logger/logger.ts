import fs from "fs";
import path from "path";
import chalk from "chalk";
import winston from "winston";
import { inkTransport } from "./ink-transport";
import { LogMetadata, LogLevel, LogDetails } from "./types";
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

function setLogColor(level: LogLevel, message: string): string {
    switch (level) {
        case LogLevel.INFO:
            return chalk.blue(message);
        case LogLevel.WARN:
            return chalk.yellow(message);
        case LogLevel.ERROR:
            return chalk.red(message);
        case LogLevel.DEBUG:
            return chalk.gray(message);
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
        const service = this.metadata?.service;
        const prefix = service ? `[${service}] ` : "";
        const formattedMessage = prefix + setLogColor(level, getString(message));
        // const formattedMessage = prefix + getString(message)
        const metadata: Omit<LogMetadata, "message"> = {
            ...this.metadata,
            id: crypto.randomUUID(),
            timestamp: new Date(),
            level,
            // message: formattedMessage,
            details,
        };

        if (level === LogLevel.ERROR) {
            Logger.logger.error(formattedMessage, metadata);
        } else if (level === LogLevel.WARN) {
            Logger.logger.warn(formattedMessage, metadata);
        } else if (level === LogLevel.DEBUG) {
            Logger.logger.debug(formattedMessage, metadata);
        } else {
            Logger.logger.info(formattedMessage, metadata);
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
