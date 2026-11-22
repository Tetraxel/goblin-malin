import { dialogBridge } from "#base/bridges/dialogBridge";
import { type DownloadTask } from "./downloadTask";
import { type CollectionTask } from "./collectionTask";

/** What a "Restart" of a track throws away, in the words the dialog uses. */
const TRACK_RESET_NOTE =
    "The metadata is fetched again and the download rows are rebuilt (your favorite / rejected choices on the " +
    "sources are lost). What you typed over the metadata, the links you added and the file name you set are kept.";

/**
 * Whether restarting this track destroys something worth asking about. A track that was never run has nothing to
 * lose, and one that failed is restarted as the usual way out of the failure.
 */
export function restartLosesWork(task: DownloadTask): boolean {
    const state = task.getAttributes()?.state;
    return state === "finished" || state === "running";
}

/**
 * Asks before restarting tracks that have work on them. Resolves true when every track may go on: nothing to lose,
 * or the user said yes. `null` (dismissed, nobody to ask) is a no, so a slip never erases anything.
 */
export async function confirmRestartTracks(tasks: DownloadTask[]): Promise<boolean> {
    const atRisk = tasks.filter(restartLosesWork).length;
    if (atRisk === 0) return true;
    const answer = await dialogBridge.confirm({
        title: atRisk === 1 ? "Restart this track?" : `Restart ${atRisk} tracks?`,
        message: TRACK_RESET_NOTE,
        // The safe button first: it is where the cursor starts.
        choices: [
            { label: "Cancel", tone: "primary" },
            { label: "Restart", tone: "danger" },
        ],
    });
    return answer === 1;
}

/**
 * Asks before restarting an album or playlist, which removes its tracks and fetches the list again. The answer is
 * what to do with the tracks: `"archive"` (they go to the archive, where they can be brought back), `"delete"`
 * (gone for good) or `null` (do nothing).
 */
export async function confirmRestartCollection(collection: CollectionTask): Promise<"archive" | "delete" | null> {
    const count = collection.getAttributes()?.childTaskIds.length ?? 0;
    const answer = await dialogBridge.confirm({
        title: "Restart this album / playlist?",
        message:
            `Its ${count} track${count === 1 ? "" : "s"} are taken out of the list and the track list is fetched ` +
            "again, so what you did on them (edits, added links, downloads) goes with them. " +
            "Archive them to be able to bring them back, or use Refetch to only add new tracks.",
        choices: [
            { label: "Cancel", tone: "primary" },
            { label: "Archive tracks, then restart", tone: "success" },
            { label: "Delete tracks, then restart", tone: "danger" },
        ],
    });
    return answer === 1 ? "archive" : answer === 2 ? "delete" : null;
}

/**
 * Says why an album or playlist cannot be restarted now: some of its tracks are still being worked on, and a restart
 * would take them out of the list while they run. A dialog, so the key that asked never looks like it did nothing.
 */
export async function explainBusyRestart(busy: number): Promise<void> {
    await dialogBridge.confirm({
        title: "Not restarted",
        message:
            `${busy} of its track${busy === 1 ? " is" : "s are"} still being worked on. ` +
            `Stop ${busy === 1 ? "it" : "them"} first (or wait for ${busy === 1 ? "it" : "them"} to finish), then restart.`,
        choices: [{ label: "OK", tone: "primary" }],
    });
}
