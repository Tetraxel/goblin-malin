/**
 * Work that must happen when the app closes, before anything is stopped or saved (the extensions' `app.exit` handlers
 * and `dispose()`). Generic: the shutdown code in `utils/exitApp.ts` runs them without knowing who registered them.
 */
const hooks = new Set<() => void | Promise<void>>();

/** Registers a hook. Returns the function that forgets it. */
export function registerExitHook(hook: () => void | Promise<void>): () => void {
    hooks.add(hook);
    return () => {
        hooks.delete(hook);
    };
}

/** Runs every hook at once and waits for them, at most `maxMs`. Never throws. Each hook runs once. */
export async function runExitHooks(maxMs = 2000): Promise<void> {
    const all = [...hooks];
    hooks.clear();
    if (all.length === 0) return;
    await Promise.race([
        Promise.allSettled(all.map(async (hook) => hook())),
        new Promise((resolve) => setTimeout(resolve, maxMs).unref?.()),
    ]);
}
