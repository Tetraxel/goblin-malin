import fs from "node:fs";
import path from "node:path";
import clipboard from "clipboardy";
import { globalLogger } from "#base/logger/logger";

/**
 * The one way the app reads and writes the system clipboard. Everything else (copying a selection, a cell, a link,
 * Claude's answer; reading a link to paste) goes through these two functions, never through `clipboardy` itself.
 *
 * `GOBLIN_TEST_CLIPBOARD` names a file that stands in for the clipboard: the TUI test harness sets it, so a scenario
 * never reads what the developer copied last nor overwrites it, and can put text "on the clipboard" and check what the
 * app copied. Unset (always, for a user), the system clipboard is used.
 */
let announcedOverride = false;

function testClipboardFile(): string | undefined {
    const file = process.env["GOBLIN_TEST_CLIPBOARD"];
    if (!file) return undefined;
    // Left set by mistake (a shell profile), every copy would go to a file and nothing would say why.
    if (!announcedOverride) {
        announcedOverride = true;
        globalLogger.debug(`GOBLIN_TEST_CLIPBOARD is set: the clipboard is the file ${file}, not the system's`);
    }
    return file;
}

/** The text on the clipboard. Rejects when it cannot be read (e.g. no clipboard tool installed on Linux). */
export async function readSystemClipboard(): Promise<string> {
    const file = testClipboardFile();
    if (file) {
        try {
            return await fs.promises.readFile(file, "utf-8");
        } catch (error) {
            // Nothing copied yet is an empty clipboard; any other failure is a failure, as it is for the real one.
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
            throw error;
        }
    }
    return clipboard.read();
}

/** Puts `text` on the clipboard. Rejects when no clipboard tool took it. */
export async function writeSystemClipboard(text: string): Promise<void> {
    const file = testClipboardFile();
    if (file) {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, text, "utf-8");
        return;
    }
    await clipboard.write(text);
}
