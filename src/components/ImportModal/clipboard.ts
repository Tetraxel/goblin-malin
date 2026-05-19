import { execSync } from "child_process";

// If the input text doesn't contain the pasted content, we use this function to read from the clipboard.
// It supports Windows, macOS, and Linux (with xclip installed).
// If the clipboard read fails for any reason, it returns an empty string.
export async function readClipboard(): Promise<string> {
    try {
        switch (process.platform) {
            case "win32":
                return execSync('powershell -command "Get-Clipboard"').toString().trim();
            case "darwin":
                return execSync("pbpaste").toString();
            default:
                return execSync("xclip -selection clipboard -o").toString();
        }
    } catch {
        return "";
    }
}
