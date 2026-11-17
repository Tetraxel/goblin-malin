import { cache } from "#utils/cache";
import { globalLogger } from "#base/logger/logger";
import { SessionManager } from "#sessions/sessionManager";
import { SessionStore } from "#sessions/sessionStore";
import { shutdownState } from "#utils/shutdownState";
import { DISABLE_MOUSE } from "#base/mouse/mouse";
import { releaseInstanceLock } from "#utils/instanceLock";
import { runAgentCleanups } from "#base/agent/cleanup";
import { TaskOrchestrator } from "#base/task/orchestrator";

const LEAVE_ALT_SCREEN_COMMAND = "\x1b[?1049l";

// The closing box is painted by Ink on its own timer: give it a moment to reach the screen before any
// synchronous work (a big cache write) freezes the event loop.
const PAINT_MS = 120;
// How long the final "closed" frame stays up before the process ends.
const LAST_FRAME_MS = 400;
// Longer when something went wrong, so the message can be read.
const LAST_FRAME_PROBLEM_MS = 2000;
// Whatever is slow to save, the app still goes away: past this, exit with what was saved.
const MAX_CLOSE_MS = 8000;
// After a crash or a signal there is no closing screen: save what we can, but don't linger.
const EMERGENCY_MAX_MS = 4000;
// Time given to the programs that were told to stop (and to the tasks reporting it) before the session is saved.
const STOP_WORK_MS = 250;

let closing = false;
let emergency = false;

/** Puts the terminal back as the shell expects it (main screen, no mouse reports). Synchronous and best effort. */
export function restoreTerminal(): void {
    try {
        process.stdout.write(DISABLE_MOUSE + LEAVE_ALT_SCREEN_COMMAND);
    } catch {
        // The terminal may already be gone (closed window): nothing left to restore.
    }
}

/**
 * Ends the downloads, conversions and searches still going on: their programs (yt-dlp, ffmpeg) would otherwise keep
 * running and writing after the app is gone and its lock released. Each task stops its own runs, which kills what it
 * started. Synchronous: the kills are sent at once.
 */
function stopRunningWork(): void {
    try {
        TaskOrchestrator.getInstance().stopProcessing();
    } catch (error) {
        globalLogger.warn("Shutdown: could not stop the running work", { error });
    }
}

/** `code` is 0 for a clean close, 1 when something was lost (a session that could not be saved, a close cut short). */
function finish(note?: string, code = 0): never {
    // Back on the normal screen the closing box is gone: leave one line saying it really ended.
    const lines = ["Goblin Malin closed.", ...(note ? [note] : [])];
    process.stdout.write(
        DISABLE_MOUSE + LEAVE_ALT_SCREEN_COMMAND + lines.join(String.fromCharCode(13, 10)) + String.fromCharCode(13, 10)
    );
    releaseInstanceLock();
    process.exit(code);
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
    let sessionSaved = true;
    // First: the tasks are told to stop (synchronously) before any program is killed, so a conversion cut by the
    // clean-ups below is a stop, not an ffmpeg failure that would be saved as the task's outcome.
    await runStep("Stopping downloads…", () => stopRunningWork());
    // Then the Claude chat (its process and server must not outlive the app, nor change anything once the session is
    // written) and the other registered programs.
    await runStep("Stopping Claude…", () => runAgentCleanups());
    // Before the session is written, so what the tasks report while stopping ("stopped") is part of it.
    await runStep("Letting the tasks report…", () => new Promise((resolve) => setTimeout(resolve, STOP_WORK_MS)));
    await runStep("Saving your session…", async () => {
        // Changes are written a moment after they happen: drop none of the latest ones.
        SessionManager.getInstance().flushNow();
        sessionSaved = await SessionStore.getInstance().flush();
    });
    await runStep("Saving the cache…", () => cache.save());
    globalLogger.info(`Shutdown: done in ${Math.round(performance.now() - startedAt)} ms`);
    // The last frame the user sees says it is over: give it time to reach the screen (and the log lines
    // above time to reach the file, which is written asynchronously) before the process goes.
    if (sessionSaved) {
        shutdownState.setDone("Everything is saved. See you soon!");
        await new Promise((resolve) => setTimeout(resolve, LAST_FRAME_MS));
        finish();
    }
    const note = "Your latest session changes could not be saved (see app.log).";
    globalLogger.error(`Shutdown: ${note}`);
    shutdownState.setDone(note);
    await new Promise((resolve) => setTimeout(resolve, LAST_FRAME_PROBLEM_MS));
    // A non-zero code: a script or a service wrapper must be able to tell that the session was not kept.
    finish(note, 1);
}

/**
 * Closes the app: shows the closing box, saves what is pending, then exits. Safe to call more than once
 * (a second press while closing does nothing).
 */
export function exitApp(): void {
    if (closing || emergency) return;
    closing = true;
    shutdownState.setStep("Closing…");
    setTimeout(() => void shutdown(), PAINT_MS);
    // Only reached when the shutdown is stuck (it ends the process itself otherwise): what was saved is all there is.
    setTimeout(
        () => finish("Closing took too long: the latest changes may not be saved (see app.log).", 1),
        MAX_CLOSE_MS
    );
}

/**
 * Ends the app when it can't close normally: a crash (`uncaughtException`) or the system asking it to stop
 * (`SIGTERM`, `SIGHUP`, `SIGINT`, closing the terminal window). There is no closing screen: the terminal is
 * put back first (so the shell is usable and the error readable), the pending session is saved as far as
 * possible within a short time, then the process ends with `exitCode`.
 */
export function emergencyExit(reason: string, exitCode: number, error?: unknown): void {
    if (emergency) return;
    emergency = true;

    restoreTerminal();
    if (error !== undefined) {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        process.stderr.write(`Goblin Malin stopped: ${reason}\n${detail}\nDetails are in app.log.\n`);
    }
    globalLogger.error(`Emergency exit: ${reason}`, error === undefined ? {} : { error });

    const end = (): never => {
        releaseInstanceLock();
        process.exit(exitCode);
    };
    setTimeout(end, EMERGENCY_MAX_MS).unref();
    void (async () => {
        try {
            // The tasks are told to stop before any program is killed (a conversion cut first would be saved as an
            // ffmpeg failure, not a stop). The clean-ups are not awaited: killing the process is enough.
            stopRunningWork();
            void runAgentCleanups(500);
            // The same short wait as a normal close: the tasks report "stopped" a moment after the kill, and the
            // session must say what the files on disk say.
            await new Promise((resolve) => setTimeout(resolve, STOP_WORK_MS));
            SessionManager.getInstance().flushNow();
            await SessionStore.getInstance().flush(EMERGENCY_MAX_MS - 1000);
            cache.save();
        } catch {
            // Already on the way out: whatever could not be saved is lost, but the process must still end.
        }
        // Let the log lines above reach the file (it is written asynchronously) before the process goes.
        await new Promise((resolve) => setTimeout(resolve, 150));
        end();
    })();
}
