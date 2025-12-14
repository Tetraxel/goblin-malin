import { LogEntry } from "winston";
import Transport from 'winston-transport'

export class InkTransport extends Transport {
    private logs: LogEntry[] = [];
    private subscribers: Set<(logs: LogEntry[]) => void> = new Set();

    constructor(opts: any) {
        super(opts)
    }

    // log(entry: LogEntry): void {
    log(info: LogEntry, callback: () => void): void {
        setImmediate(() => {
            this.emit('logged', info);
        });
        this.logs.push(info);

        // Notify all subscribers (React components)
        this.notifySubscribers();
        callback();
    }

    subscribe(callback: (logs: LogEntry[]) => void): () => void {
        this.subscribers.add(callback);
        callback(this.logs); // Send current logs immediately

        // Return unsubscribe function
        return () => {
            this.subscribers.delete(callback);
        };
    }

    private notifySubscribers(): void {
        this.subscribers.forEach(callback => callback([...this.logs]));
        this.logs = []
    }

    getLogs(): LogEntry[] {
        return [...this.logs];
    }

    filterLogs(predicate: (entry: LogEntry) => boolean): LogEntry[] {
        return this.logs.filter(predicate);
    }
}

export const inkTransport = new InkTransport({ maxLogs: 300, level: 'debug' });
