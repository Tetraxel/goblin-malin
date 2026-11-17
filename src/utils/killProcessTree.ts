import { spawn } from "child_process";

/** What this needs of a child process: yt-dlp's builder and a `ChildProcess` both fit. */
export interface Killable {
    kill(signal?: NodeJS.Signals | number): boolean;
    readonly pid?: number;
}

function plainKill(target: Killable): void {
    try {
        target.kill();
    } catch {
        /* already gone */
    }
}

/**
 * Ends a process and the programs it started. On Windows, `kill()` ends only the process itself: the ffmpeg that
 * yt-dlp spawned goes on (and keeps the half-written file locked), so the whole tree is taken down with `taskkill`.
 * `taskkill` runs FIRST: it finds the children through their parent, which a plain kill would already have removed.
 * The plain kill is only the fallback, when there is no `taskkill` or it failed. Elsewhere a plain `kill()` is what
 * there is. Never throws: a process that is already gone is not an error.
 */
export function killProcessTree(target: Killable): void {
    const pid = target.pid;
    if (process.platform !== "win32" || !pid) {
        plainKill(target);
        return;
    }
    try {
        const taskkill = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        // Exit code 128 / 1: the process is already gone, which is the goal; any other failure gets the plain kill.
        taskkill.on("error", () => plainKill(target));
        taskkill.on("exit", (code) => {
            if (code !== 0) plainKill(target);
        });
    } catch {
        plainKill(target);
    }
}
