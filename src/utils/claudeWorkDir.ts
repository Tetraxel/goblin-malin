import * as path from "path";
import { getAppDataDir } from "#utils/appPaths";
import { ensurePrivateDir } from "#utils/privateDir";

/**
 * The folder the Claude CLI runs in, and where the chat's one-turn MCP config is written. It is the app's own,
 * private (mode 0700): a shared temp folder (`/tmp` is shared between users on Linux) is no place to start a program
 * that reads and writes files, and the CLI keeps its per-folder conversation history for the chat under this path, so
 * it must be the same folder from one launch to the next (reopening the last chat resumes it).
 */
let ready: Promise<string> | undefined;

/** Creates the folder on first use (once per launch, without blocking the event loop) and gives its path. */
export function claudeWorkDir(): Promise<string> {
    ready ??= ensurePrivateDir(path.join(getAppDataDir(), "claude-work")).catch((error) => {
        // A failure is not remembered: the next call tries again.
        ready = undefined;
        throw error;
    });
    return ready;
}
