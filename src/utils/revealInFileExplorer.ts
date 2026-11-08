import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import open from "open";

/**
 * Opens the system file explorer with `filePath` selected (Windows Explorer, Finder). Linux file managers
 * have no common "select" option, so there the folder is opened instead — as it is when the file is gone.
 * Failures are swallowed: there is nothing useful to tell the user about a file manager that didn't open.
 */
export function revealInFileExplorer(filePath: string): void {
    const folder = path.dirname(filePath);
    if (!fs.existsSync(filePath)) {
        open(folder).catch(() => {});
        return;
    }

    if (process.platform === "win32") {
        // "/select," and the path are separate arguments so Node quotes a path containing spaces itself.
        // explorer.exe exits with 1 even when it worked, so the exit code is not looked at.
        spawn("explorer.exe", ["/select,", path.resolve(filePath)], { detached: true, stdio: "ignore" })
            .on("error", () => {})
            .unref();
    } else if (process.platform === "darwin") {
        spawn("open", ["-R", filePath], { detached: true, stdio: "ignore" })
            .on("error", () => {})
            .unref();
    } else {
        open(folder).catch(() => {});
    }
}
