import { LogEntry } from "winston";
import Transport from "winston-transport";

export class InkTransport extends Transport {
    private history: LogEntry[] = [];
    private pending: LogEntry[] = [];
    private subscribers: Set<(logs: LogEntry[]) => void> = new Set();

    constructor(opts: Record<string, unknown>) {
        super(opts);
    }

    log(info: LogEntry, callback: () => void): void {
        setImmediate(() => {
            this.emit("logged", info);
        });
        // Winston normalizes levels to lowercase; our LogLevel enum uses uppercase.
        const entry = { ...info, level: info.level.toUpperCase() };
        this.history.push(entry);
        this.pending.push(entry);
        this.notifySubscribers();
        callback();
    }

    subscribe(callback: (logs: LogEntry[]) => void): () => void {
        this.subscribers.add(callback);
        callback([...this.history]); // Send full history immediately on subscribe

        return () => {
            this.subscribers.delete(callback);
        };
    }

    private notifySubscribers(): void {
        const batch = [...this.pending];
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

export const inkTransport = new InkTransport({ maxLogs: 300, level: "debug" });
