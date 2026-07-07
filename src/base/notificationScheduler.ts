/**
 * Coalesces subscriber notifications into a single flush per animation frame.
 *
 * Why this exists: `Task`, `TaskStatus` and `TaskOrchestrator` each notify their
 * subscribers synchronously on every state change. Those subscribers are React
 * components (via `setState`), so each notification triggers a React commit +
 * Ink's full-tree repaint (Yoga layout + ANSI diff — the dominant per-frame cost).
 *
 * React 19 batches `setState` calls that happen in the *same* event-loop turn, but
 * async work does not cooperate: N parallel downloads each emit progress from their
 * own stdout `data` turn, so React sees N separate turns → N commits → N repaints.
 * Commit pressure therefore grows O(N) with parallelism — exactly the scaling axis
 * the app wants to grow on.
 *
 * The fix: sources mark themselves "dirty" instead of notifying inline, and the
 * scheduler flushes every dirty source *once* on the next frame. N concurrent
 * sources collapse to O(1) commits per frame regardless of how many changed.
 *
 * State reads stay correct because the *data* is mutated synchronously at the call
 * site (e.g. `Task.get()`'s cache is invalidated immediately); only the subscriber
 * fan-out — the part that schedules a render — is deferred.
 */
export type NotifyFn = () => void;

const FRAME_MS = 16; // ~1 frame at 60fps; matches Ink's default maxFps throttle.

class NotificationScheduler {
    private dirty = new Set<NotifyFn>();
    private scheduled = false;
    private syncMode = false;
    private timer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Queue `notify` to run on the next frame flush. Deduped by function identity,
     * so a source that changes many times within one frame notifies its subscribers
     * only once. Pass a *stable* function reference (a bound method) per source.
     */
    schedule(notify: NotifyFn): void {
        if (this.syncMode) {
            notify();
            return;
        }
        this.dirty.add(notify);
        if (!this.scheduled) {
            this.scheduled = true;
            this.timer = setTimeout(() => this.flush(), FRAME_MS);
        }
    }

    private flush(): void {
        this.scheduled = false;
        this.timer = null;
        if (this.dirty.size === 0) return;
        // Snapshot first: a subscriber may schedule a new notification during the
        // flush (e.g. a cascade), which must land in the *next* frame, not this one.
        const batch = Array.from(this.dirty);
        this.dirty.clear();
        for (const notify of batch) {
            try {
                notify();
            } catch {
                // A single broken subscriber must not stall the rest of the batch.
            }
        }
    }

    /** Run any pending notifications immediately (shutdown, tests, forced sync points). */
    flushNow(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.scheduled = false;
        this.flush();
    }

    /**
     * Disable batching so notifications run synchronously. Intended for tests that
     * assert on immediate post-mutation state; production always batches.
     */
    setSyncMode(enabled: boolean): void {
        if (enabled) this.flushNow();
        this.syncMode = enabled;
    }
}

export const notificationScheduler = new NotificationScheduler();
