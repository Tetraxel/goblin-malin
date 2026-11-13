import { notificationScheduler } from "../notificationScheduler";
import { type TaskPrompt } from "./task-prompt";

/**
 * Which tasks are waiting for the user right now (a question, the setup wizard).
 *
 * The prompt modals used to subscribe to every task and scan the whole list on each notification to find the one
 * with a pending prompt (O(N) per notification, O(N²) to re-subscribe). Prompts are rare and `TaskPrompt` knows when
 * it gains or loses one, so it reports here: "is anything pending?" is then O(1), and the list is only scanned when
 * something is.
 */
class PendingPrompts {
    private readonly pending = new Set<TaskPrompt>();
    private readonly listeners = new Set<() => void>();
    private version = 0;

    add(prompt: TaskPrompt): void {
        if (this.pending.has(prompt)) return;
        this.pending.add(prompt);
        this.changed();
    }

    remove(prompt: TaskPrompt): void {
        if (this.pending.delete(prompt)) this.changed();
    }

    /** True when at least one task waits for the user. */
    hasAny(): boolean {
        return this.pending.size > 0;
    }

    /** Increases whenever a prompt appears or goes away: a cheap snapshot for `useSyncExternalStore`. */
    getVersion = (): number => this.version;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private changed(): void {
        this.version++;
        // Same pacing as the task notifications, so a prompt and the status change that comes with it land together.
        notificationScheduler.schedule(this.emit);
    }

    private emit = (): void => {
        this.listeners.forEach((listener) => listener());
    };
}

export const pendingPrompts = new PendingPrompts();
