import { readSystemClipboard } from "#base/systemClipboard";

/**
 * Reads the system clipboard through `#base/systemClipboard`, without blocking the UI (it spawns the platform tool —
 * PowerShell, pbpaste, xsel/xclip/wl-paste — asynchronously; under the TUI test harness it reads a file instead).
 * Rejects when the clipboard cannot be read (e.g. no clipboard tool installed on Linux).
 */
export async function readClipboard(): Promise<string> {
    return readSystemClipboard();
}
