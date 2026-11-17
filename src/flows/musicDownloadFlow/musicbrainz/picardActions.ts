import { globalLogger } from "#base/logger/logger";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { type Task } from "#base/task/task";
import { type MusicDownloadTaskAttributes } from "../types";
import { type DownloadTask } from "../utils/downloadTask";
import { getMusicSettings } from "../settings";
import { picardPort, picardTargetFor, sendToPicard, type PicardTarget } from "./picard";

const logger = globalLogger.createChild({ service: "PicardActions" });

/** The colour of MusicBrainz Picard's own dialogs. */
const PICARD_ACCENT = "#741b81";

/** What `Task<any>` is narrowed to: a track (an album, a playlist or a group has nothing to load into Picard). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTrackTask = (t: Task<any>): t is DownloadTask =>
    (t.getAttributes() as MusicDownloadTaskAttributes | undefined)?.kind === "track";

/**
 * What Picard is asked to load for a track: ALWAYS the release when one is known (files get their album, track number
 * and cover art), the recording only when there is no release at all (see `picardTargetFor`). It comes from the
 * verdict, not from the discovery's anchor: the anchor is missing whenever discovery started from a source that has no
 * ISRC (an unofficial re-upload), even though the verdict has since found the release. The recording the discovery
 * found (its anchor's id) stands in when the verdict has none.
 */
export function picardTargetOfTask(task: DownloadTask, port: number): PicardTarget | undefined {
    const attrs = task.getAttributes();
    const identity = attrs?.musicBrainzIdentity;
    const anchorRecording = attrs?.discoveryAnchors?.["musicBrainz"]?.id;
    return picardTargetFor({ ...identity, recordingId: identity?.recordingId ?? anchorRecording }, port);
}

/** Says that nothing answered at Picard's port, and what to do about it. */
export async function explainPicardUnreachable(port: number): Promise<void> {
    await dialogBridge.confirm({
        title: "MusicBrainz Picard did not answer",
        message:
            `Nothing is listening on 127.0.0.1:${port}.\n\n` +
            "Start MusicBrainz Picard and turn on Options → Network → Browser integration (note the port it uses: " +
            "it can be changed in Goblin Malin's Settings → MusicBrainz).",
        choices: [{ label: "OK", tone: "primary" }],
        accent: PICARD_ACCENT,
    });
}

/** Asks the running Picard to load it — directly, not through the browser — and says what to do when nothing answers. */
export async function openInPicard(url: string, port: number): Promise<void> {
    if (await sendToPicard(url)) return;
    await explainPicardUnreachable(port);
}

/** What loading a whole list into Picard comes to. */
export type PicardBatchPlan = {
    /** What Picard is asked to load, once each, in the list's order. */
    targets: PicardTarget[];
    /** Tracks of the list that have something to load. */
    tracksWithTarget: number;
    /** Tracks with nothing to load (no MusicBrainz match yet, not even a recording). */
    tracksWithoutTarget: number;
};

/**
 * The batch for these tracks, given what each would be loaded as (`undefined` when nothing is known). The tracks of an
 * album share one release: it is loaded once, not once per track (Picard would just be asked for the same page again
 * and again).
 */
export function planPicardBatch(targets: readonly (PicardTarget | undefined)[]): PicardBatchPlan {
    const unique = new Map<string, PicardTarget>();
    let without = 0;
    for (const target of targets) {
        if (!target) {
            without++;
            continue;
        }
        if (!unique.has(target.url)) unique.set(target.url, target);
    }
    return {
        targets: [...unique.values()],
        tracksWithTarget: targets.length - without,
        tracksWithoutTarget: without,
    };
}

/** The batch for every track of the current list. */
export function planPicardBatchForList(): PicardBatchPlan {
    const port = picardPort(getMusicSettings().musicBrainz.picardPort);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracks = (TaskOrchestrator.getInstance().getTasks() as Task<any>[]).filter(isTrackTask);
    return planPicardBatch(tracks.map((track) => picardTargetOfTask(track, port)));
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The question asked before a batch is sent: what will be loaded, and what is left out and why. */
export function describePicardBatch(plan: PicardBatchPlan): string {
    const releases = plan.targets.filter((t) => t.kind !== "recording").length;
    const recordings = plan.targets.length - releases;
    const loads = [
        releases > 0 ? plural(releases, "release") : "",
        recordings > 0 ? plural(recordings, "recording") : "",
    ].filter(Boolean);
    const lines = [`Load ${loads.join(" and ")} in MusicBrainz Picard, for ${plural(plan.tracksWithTarget, "track")}?`];
    if (plan.tracksWithTarget > plan.targets.length) {
        lines.push("Tracks of the same album share one release, which is loaded once.");
    }
    if (plan.targets.some((t) => t.kind === "candidate")) {
        lines.push(
            "Some releases are only the best candidate of a match that is still to review: Picard just loads them, nothing is saved."
        );
    }
    if (plan.tracksWithoutTarget > 0) {
        lines.push(`${plural(plan.tracksWithoutTarget, "track")} with no MusicBrainz match yet will be left out.`);
    }
    lines.push("Picard must be running with its browser integration on.");
    return lines.join("\n\n");
}

/**
 * "Open all tracks in MusicBrainz Picard": asks first (it can be hundreds of releases), then sends them one after the
 * other. Stops at the first one Picard does not answer, and says so.
 */
export async function openAllInPicard(): Promise<void> {
    const port = picardPort(getMusicSettings().musicBrainz.picardPort);
    const plan = planPicardBatchForList();
    if (plan.targets.length === 0) {
        await dialogBridge.confirm({
            title: "Nothing to open in Picard",
            message:
                "No track of the list has a MusicBrainz match yet. Run the tracks (or press Re-check on a track's MusicBrainz cell) and try again.",
            choices: [{ label: "OK", tone: "primary" }],
            accent: PICARD_ACCENT,
        });
        return;
    }

    const answer = await dialogBridge.confirm({
        title: "Open all tracks in MusicBrainz Picard",
        message: describePicardBatch(plan),
        // Nothing here is destructive: the first button does what the user came for.
        choices: [
            { label: `Open ${plan.targets.length}`, tone: "primary" },
            { label: "Cancel", tone: "muted" },
        ],
        accent: PICARD_ACCENT,
    });
    if (answer !== 0) return;

    let sent = 0;
    for (const target of plan.targets) {
        if (!(await sendToPicard(target.url))) {
            logger.warn(`Picard did not answer after ${sent} of ${plan.targets.length}`);
            await explainPicardUnreachable(port);
            return;
        }
        sent++;
    }
    logger.info(`Sent ${sent} release(s)/recording(s) to Picard`);
}
