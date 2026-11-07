import { cache } from "#utils/cache";
import { globalLogger } from "#base/logger/logger";
import { SessionManager } from "#sessions/sessionManager";
import { SessionStore } from "#sessions/sessionStore";
import { shutdownState } from "#utils/shutdownState";
import { DISABLE_MOUSE } from "#base/mouse/mouse";

const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

// The closing box is painted by Ink on its own timer: give it a moment to reach the screen before any
// synchronous work (a big cache write) freezes the event loop.
const PAINT_MS = 120;
// How long the final "closed" frame stays up before the process ends.
const LAST_FRAME_MS = 400;
// Whatever is slow to save, the app still goes away: past this, exit with what was saved.
const MAX_CLOSE_MS = 8000;

let closing = false;

function finish(): never {
    // Back on the normal screen the closing box is gone: leave one line saying it really ended.
    process.stdout.write(DISABLE_MOUSE + LEAVE_ALT_SCREEN_COMMAND + "Goblin Malin closed." + String.fromCharCode(13, 10));
    process.exit(0);
}

async function runStep(label: string, work: () => void | Promise<void>): Promise<void> {
    shutdownState.setStep(label);
    const startedAt = performance.now();
    try {
        await work();
    } catch (error) {
        globalLogger.warn(`Shutdown: "${label}" failed`, { error });
    }
    // The log is the place to look when closing feels slow: it says which step took the time.
    globalLogger.info(`Shutdown: "${label}" took ${Math.round(performance.now() - startedAt)} ms`);
}

async function shutdown(): Promise<void> {
    const startedAt = performance.now();
    await runStep("Saving your session…", async () => {
        // Changes are written a moment after they happen: drop none of the latest ones.
        SessionManager.getInstance().flushNow();
        await SessionStore.getInstance().flush();
    });
    await runStep("Saving the cache…", () => cache.save());
    globalLogger.info(`Shutdown: done in ${Math.round(performance.now() - startedAt)} ms`);
    // The last frame the user sees says it is over: give it time to reach the screen (and the log lines
    // above time to reach the file, which is written asynchronously) before the process goes.
    shutdownState.setDone("Everything is saved. See you soon!");
    await new Promise((resolve) => setTimeout(resolve, LAST_FRAME_MS));
    finish();
}

/**
 * Closes the app: shows the closing box, saves what is pending, then exits. Safe to call more than once
 * (a second press while closing does nothing).
 */
export function exitApp(): void {
    if (closing) return;
    closing = true;
    shutdownState.setStep("Closing…");
    setTimeout(() => void shutdown(), PAINT_MS);
    setTimeout(finish, MAX_CLOSE_MS);
}
