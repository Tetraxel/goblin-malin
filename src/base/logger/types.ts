import { Task } from "../task/task"

export enum LogLevel {
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
    DEBUG = "DEBUG",
}

export type LogDetails = {
    [key: string]: any
}

export interface LogMetadata {
    id: string,
    timestamp: Date
    level: LogLevel
    message: string
    service?: string
    flow?: string
    task?: Task<any>
    details?: LogDetails // will be printed in the terminal
    [key: string]: any // Allow additional context fields
}
