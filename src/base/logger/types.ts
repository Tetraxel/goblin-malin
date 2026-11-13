import { type Task } from "../task/task";

export enum LogLevel {
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
    DEBUG = "DEBUG",
}

/** Severity order, for "show this level and above" filters. */
export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
};

export type LogDetails = {
    [key: string]: unknown;
};

export interface LogMetadata {
    id: string;
    timestamp: Date;
    level: LogLevel;
    message: string;
    service?: string;
    flow?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    task?: Task<any>;
    details?: LogDetails; // will be printed in the terminal
    [key: string]: unknown; // Allow additional context fields
}
