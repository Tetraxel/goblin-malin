import { useEffect, useState } from "react";
import { fpsTracker, FpsStats, EMPTY_FPS_STATS } from "#base/fpsTracker";

/**
 * Returns live FPS statistics measured by Ink's onRender callback.
 * Resets min/max each time `enabled` switches to true for a fresh reading.
 */
export function useFps(enabled: boolean): FpsStats {
    const [stats, setStats] = useState<FpsStats>(fpsTracker.getStats());

    useEffect(() => {
        if (!enabled) return;
        fpsTracker.reset();
        return fpsTracker.subscribe(setStats);
    }, [enabled]);

    return enabled ? stats : EMPTY_FPS_STATS;
}
