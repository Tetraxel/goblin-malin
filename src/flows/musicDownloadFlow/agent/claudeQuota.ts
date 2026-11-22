import fs from "node:fs/promises";
import path from "node:path";
import { globalLogger } from "#base/logger/logger";
import { getAppDataDir } from "#utils/appPaths";
import { renameReplacing } from "#utils/dataFile";
import { type QuotaWindow, type QuotaWindows } from "../services/apis/claude-agent-client";

const logger = globalLogger.createChild({ service: "ClaudeQuota" });

/**
 * How much of the user's Claude plan is used, as the CLI last reported it. The CLI only tells while it runs a
 * message (there is nothing to ask in between, and a probe would cost usage), so the figures are those of the last
 * message, kept on disk to show again at the next launch.
 */
export const CLAUDE_QUOTA_FILE = "claude-quota.json";

export type QuotaSnapshot = {
    windows: QuotaWindows;
    /** When the figures were reported (epoch ms); 0 when never. */
    at: number;
};

const EMPTY: QuotaSnapshot = { windows: {}, at: 0 };

const isWindow = (v: unknown): v is QuotaWindow =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as QuotaWindow).utilization === "number" &&
    typeof (v as QuotaWindow).resetsAt === "number";

export class ClaudeQuotaStore {
    private snapshot: QuotaSnapshot = EMPTY;
    private listeners = new Set<() => void>();
    private loaded = false;

    constructor(
        private readonly persist?: {
            load: () => Promise<QuotaSnapshot | undefined>;
            save: (s: QuotaSnapshot) => Promise<void>;
        }
    ) {}

    /** Stable between changes: safe for `useSyncExternalStore`. */
    getSnapshot = (): QuotaSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private commit(next: QuotaSnapshot): void {
        this.snapshot = next;
        this.listeners.forEach((l) => l());
    }

    /** Reads what the last launch saw, once. Figures already reported by this launch win. */
    async ensureLoaded(): Promise<void> {
        if (this.loaded || !this.persist) return;
        this.loaded = true;
        const saved = await this.persist.load();
        if (saved && this.snapshot.at === 0) this.commit(saved);
    }

    /** What a message's run reported. A window the report leaves out keeps its last figure. */
    update(windows: QuotaWindows, now: number = Date.now()): void {
        const merged: QuotaWindows = { ...this.snapshot.windows, ...windows };
        // The same figures again change nothing on screen: no repaint.
        const old = this.snapshot.windows;
        const same =
            old.fiveHour?.utilization === merged.fiveHour?.utilization &&
            old.fiveHour?.resetsAt === merged.fiveHour?.resetsAt &&
            old.sevenDay?.utilization === merged.sevenDay?.utilization &&
            old.sevenDay?.resetsAt === merged.sevenDay?.resetsAt;
        const next = { windows: merged, at: now };
        if (same) {
            this.snapshot = next;
        } else {
            this.commit(next);
        }
        if (this.persist) void this.persist.save(next);
    }
}

const filePath = (): string => path.join(getAppDataDir(), CLAUDE_QUOTA_FILE);

/** The save in flight: the next one waits for it. Never rejects. */
let saving: Promise<void> = Promise.resolve();
let saveCount = 0;

export const claudeQuota = new ClaudeQuotaStore({
    async load() {
        try {
            const raw = JSON.parse(await fs.readFile(filePath(), "utf8")) as Partial<QuotaSnapshot>;
            const w = raw.windows ?? {};
            const windows: QuotaWindows = {
                ...(isWindow(w.fiveHour) ? { fiveHour: w.fiveHour } : {}),
                ...(isWindow(w.sevenDay) ? { sevenDay: w.sevenDay } : {}),
            };
            return windows.fiveHour || windows.sevenDay
                ? { windows, at: typeof raw.at === "number" ? raw.at : 0 }
                : undefined;
        } catch {
            return undefined;
        }
    },
    // Saves one after the other (two answers that report usage close together would otherwise race on the file),
    // each through its own temp name, renamed with the Windows retry of `renameReplacing`.
    save(snapshot) {
        const run = saving.then(() => writeSnapshot(snapshot));
        saving = run;
        return run;
    },
});

async function writeSnapshot(snapshot: QuotaSnapshot): Promise<void> {
    const target = filePath();
    const temp = `${target}.${process.pid}-${++saveCount}.tmp`;
    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(temp, JSON.stringify(snapshot), "utf8");
        await renameReplacing(temp, target);
    } catch (error) {
        logger.warn(`Could not save the plan usage: ${(error as Error).message}`);
        await fs.rm(temp, { force: true }).catch(() => undefined);
    }
}

// ── What the panel shows ──────────────────────────────────────────────────

export type QuotaRow = {
    label: string;
    /** 0–1. */
    share: number;
    /** The window had already reset when the figure was drawn: nothing has been used since. */
    reset: boolean;
    resetsAt: number;
    /** "resets 14:30", or "reset" when it has. */
    text: string;
};

/**
 * The rows to draw. A window whose reset time has passed is shown empty (the figure is from before it reset), still
 * with its old reset time marked as past by `reset`.
 */
export function quotaRows(snapshot: QuotaSnapshot, now: number = Date.now()): QuotaRow[] {
    const row = (label: string, w: QuotaWindow | undefined): QuotaRow[] => {
        if (!w) return [];
        const reset = w.resetsAt <= now;
        const text = reset ? "reset" : `resets ${formatResetTime(w.resetsAt, now)}`;
        return [{ label, share: reset ? 0 : w.utilization, reset, resetsAt: w.resetsAt, text }];
    };
    return [...row("5h", snapshot.windows.fiveHour), ...row("7d", snapshot.windows.sevenDay)];
}

/** "14:30" for a time today, "Fri 14:30" for another day. */
export function formatResetTime(at: number, now: number = Date.now()): string {
    const d = new Date(at);
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const sameDay = d.toDateString() === new Date(now).toDateString();
    return sameDay ? time : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`;
}
