import clipboard from "clipboardy";

/**
 * Reads the system clipboard without blocking the UI (clipboardy spawns the platform tool —
 * PowerShell, pbpaste, xsel/xclip/wl-paste — asynchronously).
 * Rejects when the clipboard cannot be read (e.g. no clipboard tool installed on Linux).
 */
export async function readClipboard(): Promise<string> {
    return clipboard.read();
}
