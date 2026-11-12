import clipboard from "clipboardy";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { globalLogger } from "#base/logger/logger";
import { detectUrls } from "#components/ImportModal/detectUrls";
import { type DownloadTask } from "./downloadTask";

const logger = globalLogger.createChild({ service: "AddLink" });

async function notify(title: string, message: string): Promise<void> {
    await dialogBridge.confirm({ title, message, choices: [{ label: "OK", tone: "primary" }] });
}

const shorten = (url: string): string => (url.length > 56 ? `${url.slice(0, 55)}…` : url);

/**
 * "Paste link": adds the track link(s) in the clipboard (or in `text`) to `task` as sources. This is how the user
 * tells the app which track a source really is — e.g. the official Spotify track of an unofficial YouTube re-upload —
 * when the automatic search cannot find it. A success is silent (the new row appears in the Metadata Sources panel,
 * [USER]-badged and favorited); whatever could not be added is explained, never dropped without a word.
 */
export async function addLinkFromClipboard(task: DownloadTask, text?: string): Promise<void> {
    let raw = text;
    if (raw === undefined) {
        try {
            raw = await clipboard.read();
        } catch (error) {
            logger.error("Clipboard read failed", { error });
            await notify(
                "Can't read the clipboard",
                process.platform === "linux"
                    ? "Install xsel, xclip or wl-clipboard (Wayland) so Goblin Malin can read it."
                    : "The system clipboard could not be read."
            );
            return;
        }
    }

    const links = detectUrls(raw).map((d) => d.raw);
    if (links.length === 0) {
        await notify(
            raw.trim() === "" ? "Clipboard is empty" : "No link in the clipboard",
            "Copy the link of a track (Spotify, YouTube…), then paste it again."
        );
        return;
    }

    const { added, skipped } = await task.addUserSources(links);
    logger.info(`Added ${added.length} link(s) to the track by hand; ${skipped.length} not added`);
    if (skipped.length > 0) {
        await notify(
            added.length > 0 ? "Some links were not added" : "Nothing was added",
            skipped.map((s) => `${shorten(s.url)}\n  ${s.reason}`).join("\n\n")
        );
    }
}
