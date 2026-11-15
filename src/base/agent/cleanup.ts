/**
 * Things the agent starts that must not outlive the app (the Claude CLI process of a turn, the MCP server).
 * Whoever starts one registers how to stop it; closing the app (or a crash) runs them all. Lives in `base/` so the
 * shutdown code in `utils/` can call it without knowing anything about music.
 */
const cleanups = new Set<() => void | Promise<void>>();

/** Registers a stop function. Returns the function that forgets it (call it when the thing ended on its own). */
export function registerAgentCleanup(stop: () => void | Promise<void>): () => void {
    cleanups.add(stop);
    return () => {
        cleanups.delete(stop);
    };
}

/** Stops everything registered. Never throws; each stop is given the same short time. */
export async function runAgentCleanups(maxMs = 1500): Promise<void> {
    const stops = [...cleanups];
    cleanups.clear();
    await Promise.race([
        Promise.allSettled(stops.map(async (stop) => stop())),
        new Promise((resolve) => setTimeout(resolve, maxMs).unref?.()),
    ]);
}
