import { useEffect, useState } from "react";

// A registry to store one timer per interval speed
interface TimerEntry {
    id: NodeJS.Timeout;
    listeners: Set<(tick: number) => void>;
    tick: number; // The global tick count for this speed
}

const activeTimers: Record<number, TimerEntry> = {};

/**
 * Subscribes to a global ticker for a specific interval.
 * Returns the current global tick and a cleanup function.
 */
export function useGlobalTicker(interval: number): number {
    // Initialize with the current global tick for this interval, or 0
    const [tick, setTick] = useState(() => activeTimers[interval]?.tick || 0);

    useEffect(() => {
        // 1. Create timer entry if it doesn't exist for this specific speed
        if (!activeTimers[interval]) {
            activeTimers[interval] = {
                listeners: new Set(),
                tick: 0,
                id: setInterval(() => {
                    const entry = activeTimers[interval];
                    entry.tick++; // Increment global counter
                    // Notify all components listening to this speed
                    entry.listeners.forEach((listener) => listener(entry.tick));
                }, interval),
            };
        }

        const entry = activeTimers[interval];

        // 2. Subscribe this component's setTick function
        entry.listeners.add(setTick);

        // 3. Cleanup on unmount
        return () => {
            entry.listeners.delete(setTick);

            // If no one is listening anymore, kill the timer to free resources
            if (entry.listeners.size === 0) {
                clearInterval(entry.id);
                delete activeTimers[interval];
            }
        };
    }, [interval]);

    return tick;
}
