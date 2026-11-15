import fs from "node:fs/promises";
import path from "node:path";
import { getAppDataDir } from "#utils/appPaths";
import { getAgentSettings } from "./agentSettings";

/**
 * `agent.log`: everything said in the conversation with Claude and every call of its tools, raw, one JSON object per
 * line (like `app.log`): what the user wrote and the full prompt it became, what Claude answered, each tool call with
 * its input and what it answered (uncut), notes, errors, and the cost of each turn. For working out afterwards what
 * Claude did and why. It stays on this computer; it can be switched off in Settings.
 *
 * Writes are queued and asynchronous: logging never slows the chat, and never throws.
 */
export type AgentLogEntry = { kind: string } & Record<string, unknown>;

/** What the chat needs of a log (swapped for a fake in tests). */
export type AgentLogWriter = { write(entry: AgentLogEntry): void };

export const AGENT_LOG_FILE = "agent.log";
/** When the file passes this, it moves to `agent.log.1` (replacing the previous one) and a new one starts. */
export const AGENT_LOG_MAX_BYTES = 10 * 1024 * 1024;

export class AgentLog implements AgentLogWriter {
    private queue: Promise<void> = Promise.resolve();
    private size: number | undefined;

    constructor(
        private readonly filePath: () => string = () => path.join(getAppDataDir(), AGENT_LOG_FILE),
        private readonly enabled: () => boolean = () => getAgentSettings().keepLog,
        private readonly maxBytes = AGENT_LOG_MAX_BYTES
    ) {}

    write(entry: AgentLogEntry): void {
        let line: string;
        try {
            if (!this.enabled()) return;
            line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
        } catch {
            return;
        }
        this.queue = this.queue.then(() => this.append(line)).catch(() => undefined);
    }

    /** Resolves once everything written so far is on disk (for tests, and for quitting). */
    flush(): Promise<void> {
        return this.queue;
    }

    private async append(line: string): Promise<void> {
        const file = this.filePath();
        if (this.size === undefined) {
            this.size = await fs.stat(file).then(
                (s) => s.size,
                () => 0
            );
        }
        if (this.size > this.maxBytes) {
            await fs.rm(`${file}.1`, { force: true });
            await fs.rename(file, `${file}.1`).catch(() => undefined);
            this.size = 0;
        }
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, line, "utf8");
        this.size += Buffer.byteLength(line);
    }
}

export const agentLog = new AgentLog();
