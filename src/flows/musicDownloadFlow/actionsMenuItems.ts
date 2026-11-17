import { actionsMenuRegistry } from "#base/actionsMenu";
import { openAllInPicard, planPicardBatchForList } from "./musicbrainz/picardActions";

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
}
