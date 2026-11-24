import { actionsMenuRegistry } from "#base/actionsMenu";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { openAllInPicard, planPicardBatchForList } from "./musicbrainz/picardActions";
import { type MusicDownloadTaskAttributes } from "./types";
import { type DownloadTask } from "./utils/downloadTask";
import { activeStemProvider } from "./stems/stemProviders";
import { separateStemsOf } from "./stems/stemColumnActions";

/** The tracks that have a file to separate (saved, or a selected download) and no stems yet. */
function tracksWithoutStems(): DownloadTask[] {
    return (TaskOrchestrator.getInstance().getTasks() as unknown as DownloadTask[]).filter((task) => {
        const attrs = task.getAttributes() as MusicDownloadTaskAttributes | undefined;
        if (attrs?.kind !== "track") return false;
        if ((attrs.stemRuns ?? []).length > 0 || Object.keys(attrs.savedStems ?? {}).length > 0) return false;
        return !!attrs.savedFile || attrs.downloadSources.some((s) => s.selected && s.localFile?.state === "found");
    });
}

/** What the toolbar's "Actions" menu offers for the music list. Called once, from `initMusicApp()`. */
export function registerActionsMenuItems(): void {
    actionsMenuRegistry.register({
        id: "picard.openAll",
        label: "Open all tracks in MusicBrainz Picard",
        description: "Loads each release in Picard (its browser integration must be on)",
        unavailableReason: () =>
            planPicardBatchForList().targets.length === 0 ? "No track has a MusicBrainz match yet" : undefined,
        run: openAllInPicard,
    });

    actionsMenuRegistry.register({
        id: "stems.separateAll",
        label: "Separate stems of every downloaded track",
        description: "Tracks with a file and no stems yet, one after the other, with the default model",
        unavailableReason: () =>
            !activeStemProvider()
                ? "Stem separation is off (Settings → Stems)"
                : tracksWithoutStems().length === 0
                  ? "Every downloaded track has stems already"
                  : undefined,
        run: async () => {
            const tracks = tracksWithoutStems();
            const answer = await dialogBridge.confirm({
                title: "Separate stems?",
                message: `${tracks.length} track${tracks.length === 1 ? "" : "s"} will be separated, one after the other, on this computer (under a minute each on an NVIDIA card, about 10 minutes each on the processor).`,
                choices: [
                    { label: "Not now", tone: "primary" },
                    { label: "Separate", tone: "success" },
                ],
            });
            if (answer === 1) await separateStemsOf(tracks);
        },
    });
}
