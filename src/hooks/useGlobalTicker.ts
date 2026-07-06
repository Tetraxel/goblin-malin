import { useEffect, useState } from "react";

// Every animated spinner in the app is driven by ONE master timer at this base
// cadence. A caller's requested interval is snapped to the nearest multiple of
// the base, and all subscribers are notified inside the same timer callback — so
// React batches their state updates into a single commit (and therefore a single
// Ink full-tree repaint) per tick, no matter how many spinners are on screen or
// what intervals they asked for. Previously each distinct interval spun up its
// own timer, so a toolbar spinner (80ms) and row spinners (200ms) painted the
// whole tree on two unrelated schedules.
const BASE_INTERVAL_MS = 125;

interface Subscriber {
    listener: (tick: number) => void;
    // How many base ticks pass before this subscriber's frame advances.
    steps: number;
}

const subscribers = new Set<Subscriber>();
let masterTimer: ReturnType<typeof setInterval> | null = null;
let masterTick = 0;

function ensureTimer(): void {
    if (masterTimer) return;
    masterTimer = setInterval(() => {
        masterTick++;
        // One synchronous sweep → React coalesces every setState into one commit.
        subscribers.forEach((sub) => sub.listener(Math.floor(masterTick / sub.steps)));
    }, BASE_INTERVAL_MS);
}

function stopTimerIfIdle(): void {
    if (subscribers.size === 0 && masterTimer) {
        clearInterval(masterTimer);
        masterTimer = null;
    }
}

/**
 * Subscribes to the shared animation ticker and returns a monotonically
 * increasing frame counter that advances every ~`interval` ms.
 *
 * @param interval  Desired frame duration in ms (snapped to a multiple of the base cadence).
 * @param enabled   When false, the component does not subscribe or re-render, and 0 is returned.
 */
export function useGlobalTicker(interval: number, enabled: boolean = true): number {
    const steps = Math.max(1, Math.round(interval / BASE_INTERVAL_MS));
    const [tick, setTick] = useState(() => Math.floor(masterTick / steps));

    useEffect(() => {
        if (!enabled) return;
        const sub: Subscriber = { listener: setTick, steps };
        subscribers.add(sub);
        ensureTimer();
        return () => {
            subscribers.delete(sub);
            stopTimerIfIdle();
        };
    }, [steps, enabled]);

    return enabled ? tick : 0;
}
