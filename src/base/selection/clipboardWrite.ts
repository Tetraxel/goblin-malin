import clipboard from "clipboardy";
import { globalLogger } from "#base/logger/logger";

/** Past this many bytes of text, terminals start refusing the OSC 52 sequence; the system clipboard takes it all. */
const OSC52_MAX_TEXT_BYTES = 100_000;

/**
 * The terminal's own "set the clipboard" sequence (OSC 52). It works through SSH and in a container, where no
 * clipboard tool of this machine reaches the user's clipboard, and in the terminals that have no tool to call.
 * Inside tmux it has to be wrapped to reach the terminal around it. Empty when the text is too long for it.
 */
export function osc52Sequence(text: string, env: NodeJS.ProcessEnv = process.env): string {
    if (Buffer.byteLength(text, "utf8") > OSC52_MAX_TEXT_BYTES) return "";
    const sequence = `\u001B]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`;
    if (env.TMUX) return `\u001BPtmux;${sequence.replaceAll("\u001B", "\u001B\u001B")}\u001B\\`;
    return sequence;
}

/**
 * Puts `text` on the user's clipboard, by both ways there are: the terminal's (OSC 52) and this machine's tool
 * (pbcopy, clip, wl-copy, xclip…). A terminal that ignores the first, or a machine with no tool, is covered by the
 * other, so neither failure is an error. Resolves to whether the system tool took it.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    const sequence = osc52Sequence(text);
    if (sequence !== "" && process.stdout.isTTY) {
        try {
            process.stdout.write(sequence);
        } catch (error) {
            globalLogger.debug("Could not write the clipboard sequence to the terminal", { error });
        }
    }
    try {
        await clipboard.write(text);
        return true;
    } catch (error) {
        globalLogger.debug("No system clipboard tool took the selection", { error });
        return false;
    }
}
