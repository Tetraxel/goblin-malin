import { LogEntry } from "winston";
import Transport from "winston-transport";

// How long buffered log entries wait before being delivered to subscribers. A
// long download with debug logging emits thousands of lines; without batching,
// each one triggered a React commit + full Ink repaint. Coalescing to one
// delivery per window turns that into ≤10 commits/s regardless of log volume.
const FLUSH_MS = 100;
// Default ring-buffer size when `maxLogs` isn't supplied. Bounds memory for a
// long-running session (history previously grew without limit).
const DEFAULT_MAX_LOGS = 2000;

export class InkTransport extends Transport {
    private history: LogEntry[] = [];
    private pending: LogEntry[] = [];
    private subscribers: Set<(logs: LogEntry[]) => void> = new Set();
    private readonly maxLogs: number;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(opts: Record<string, unknown>) {
        super(opts);
        this.maxLogs = typeof opts.maxLogs === "number" ? opts.maxLogs : DEFAULT_MAX_LOGS;
    }

    log(info: LogEntry, callback: () => void): void {
        setImmediate(() => {
            this.emit("logged", info);
        });
        // Winston normalizes levels to lowercase; our LogLevel enum uses uppercase.
        const entry = { ...info, level: info.level.toUpperCase() };
        this.history.push(entry);
        // Ring buffer: keep only the most recent `maxLogs` entries.
        if (this.history.length > this.maxLogs) {
            this.history.splice(0, this.history.length - this.maxLogs);
        }
        this.pending.push(entry);
        this.scheduleFlush();
        callback();
    }

    subscribe(callback: (logs: LogEntry[]) => void): () => void {
        // Deliver any buffered entries to existing subscribers first so the history
        // snapshot we hand this new subscriber is complete — and so none of those
        // entries get re-delivered to it in a later batch (they'd be double-counted).
        this.flushPending();
        this.subscribers.add(callback);
        callback([...this.history]); // Send full history immediately on subscribe
        return () => {
            this.subscribers.delete(callback);
        };
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => this.flushPending(), FLUSH_MS);
    }

    private flushPending(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.pending.length === 0) return;
        const batch = this.pending;
        this.pending = [];
        this.subscribers.forEach((callback) => callback(batch));
    }

    getLogs(): LogEntry[] {
        return [...this.history];
    }

    filterLogs(predicate: (entry: LogEntry) => boolean): LogEntry[] {
        return this.history.filter(predicate);
    }
}

export const inkTransport = new InkTransport({ maxLogs: DEFAULT_MAX_LOGS, level: "debug" });
