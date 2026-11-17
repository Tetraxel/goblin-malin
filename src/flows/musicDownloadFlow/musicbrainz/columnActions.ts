import open from "open";
import { globalLogger } from "#base/logger/logger";
import { type Task } from "#base/task/task";
import { type ContextualActions, type Shortcut } from "#types/actions";
import { type DownloadTask } from "../utils/downloadTask";
import { metadataLimiter } from "../utils/stageLimiters";
import { type MusicDownloadTaskAttributes } from "../types";
import { getMusicSettings } from "../settings";
import { computeCompiledMetadata } from "../utils/compiledMetadata";
import { picardPort } from "./picard";
import { openInPicard, picardTargetOfTask } from "./picardActions";
import { tagLookupUrl } from "./tagLookup";
import {
    addToMusicBrainz,
    chooseMusicBrainzAlternative,
    openMusicBrainzExternalLinks,
    ambiguousArtists,
    recheckMusicBrainz,
    reviewMusicBrainzArtists,
    reviewMusicBrainzRelease,
} from "./identityActions";

const logger = globalLogger.createChild({ service: "MusicBrainzActions" });

/** Runs an async action from a key press or a click: its failure is logged, never thrown at the handler. */
function fire(label: string, run: () => Promise<unknown>): void {
    run().catch((error) => logger.error(`${label} failed`, { error }));
}

// `Task` is invariant in its attributes: a list of tasks of any kind is only readable as `Task<any>`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTrackTask = (t: Task<any>): t is DownloadTask =>
    (t.getAttributes() as MusicDownloadTaskAttributes | undefined)?.kind === "track";

/**
 * One thing the user can do about a track's MusicBrainz verdict. The task list's MusicBrainz column turns these into
 * keyboard actions, the metadata panel into buttons — one list, so the two can never drift apart.
 */
export type MusicBrainzActionItem = {
    /** Stable name, e.g. for tests. */
    id: "picard" | "open" | "links" | "alternatives" | "group" | "review" | "artist" | "add" | "search" | "recheck";
    /** The action bar's label (the shortcut's registry id derives from it: keep it stable). */
    label: string;
    /** The short text of a button. */
    buttonLabel: string;
    description: string;
    shortcut: Shortcut;
    run: () => void;
};

/** What can be done about the track's verdict right now, most relevant first. */
export function musicBrainzActionItems(task: DownloadTask): MusicBrainzActionItem[] {
    // An album/playlist row has no metadata groups to check (`computeCompiledMetadata` would throw on them).
    if (!isTrackTask(task)) return [];
    const identity = task.getAttributes()?.musicBrainzIdentity;
    const items: MusicBrainzActionItem[] = [];

    if (identity?.verdict === "needsReview" && identity.candidates.length > 0) {
        items.push({
            id: "review",
            label: "Review MusicBrainz match",
            buttonLabel: "Review match…",
            description: "Pick the right release among the candidates, or say none is",
            shortcut: { input: "v" },
            run: () => fire("Review release", () => reviewMusicBrainzRelease(task)),
        });
    }
    if (ambiguousArtists(identity).length > 0) {
        items.push({
            id: "artist",
            label: "Choose MusicBrainz artist",
            buttonLabel: "Choose artist…",
            description: "Several MusicBrainz artists share this name",
            shortcut: { input: "t" },
            run: () => fire("Review artists", () => reviewMusicBrainzArtists(task)),
        });
    }
    if (identity?.verdict === "notFound") {
        items.push({
            id: "add",
            label: "Add to MusicBrainz",
            buttonLabel: "Add to MusicBrainz…",
            description: "Open MusicBrainz to add this release (you review and submit it yourself)",
            shortcut: { input: "a" },
            run: () => fire("Add to MusicBrainz", () => addToMusicBrainz(task)),
        });
    }
    // Picard: ALWAYS the release when one is known, the recording only when there is no release at all
    // (see `picardTargetOfTask`).
    const port = picardPort(getMusicSettings().musicBrainz.picardPort);
    const target = picardTargetOfTask(task, port);
    const picard = target?.url;
    if (picard && target) {
        items.push({
            id: "picard",
            label: "Open in MusicBrainz Picard",
            buttonLabel: "Open in Picard ↗",
            description:
                (target.kind === "release"
                    ? "Load the release in MusicBrainz Picard (cover art and album included)"
                    : target.kind === "candidate"
                      ? "Load the best candidate release in MusicBrainz Picard (not confirmed yet)"
                      : "Load the recording in MusicBrainz Picard (no release is known)") +
                "; Picard must be running with its browser integration on",
            shortcut: { key: "return" },
            run: () => fire("Open in Picard", () => openInPicard(picard, port)),
        });
    }
    if (identity?.verdict === "matched" && identity.release) {
        const url = `https://musicbrainz.org/release/${identity.release.id}`;
        items.push({
            id: "open",
            label: "Open release in MusicBrainz",
            buttonLabel: "Open release ↗",
            description: "Open the matched release in your browser",
            shortcut: { input: "l" },
            run: () => fire("Open release", () => open(url)),
        });
    }
    if (identity?.verdict === "matched" && identity.release) {
        items.push({
            id: "links",
            label: "Pages of the MusicBrainz release",
            buttonLabel: "Pages ↗…",
            description:
                "Spotify, Bandcamp, Discogs… as listed on MusicBrainz (Spotify, Deezer, Tidal open in their app)",
            shortcut: { input: "x" },
            run: () => fire("Release pages", () => openMusicBrainzExternalLinks(task)),
        });
    }
    if (identity?.verdict === "matched" && (identity.alternatives?.length ?? 0) > 0) {
        items.push({
            id: "alternatives",
            label: "Other MusicBrainz releases",
            buttonLabel: "Other releases…",
            description: "See the other releases that could be this one (editions of the album) and pick another",
            shortcut: { input: "u" },
            run: () => fire("Other releases", () => chooseMusicBrainzAlternative(task)),
        });
    }
    if (identity?.verdict === "matched" && identity.releaseGroupId) {
        const url = `https://musicbrainz.org/release-group/${identity.releaseGroupId}`;
        items.push({
            id: "group",
            label: "Open MusicBrainz release group",
            buttonLabel: "Release group ↗",
            description: "Open the release group (all the editions of this album) in your browser",
            shortcut: { input: "g" },
            run: () => fire("Open release group", () => open(url)),
        });
    }
    // Always on offer once the sources gave a title and an artist: a hand search is what the user reaches for when the
    // automatic check found nothing, or the wrong thing.
    const attrs = task.getAttributes();
    const lookup = attrs && tagLookupUrl(computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride));
    if (lookup) {
        items.push({
            id: "search",
            label: "Search on MusicBrainz",
            buttonLabel: "⌕ Search",
            description: "Open MusicBrainz's tag lookup in your browser, prefilled with this track",
            shortcut: { input: "f" },
            run: () => fire("Search on MusicBrainz", () => open(lookup)),
        });
    }
    items.push({
        id: "recheck",
        label: "Re-check on MusicBrainz",
        buttonLabel: "↻ Re-check",
        description: "Ask MusicBrainz again (after adding a release, or when a check failed)",
        shortcut: { input: "k" },
        run: () => fire("Re-check", () => recheckMusicBrainz(task)),
    });
    return items;
}

/**
 * What the MusicBrainz column offers for a track, by what the identity checks concluded. Declared on the discovery
 * service (`static columnActions`), so the task list reads it without knowing which provider it is.
 */
export function musicBrainzColumnActions(task: DownloadTask): ContextualActions[] {
    return musicBrainzActionItems(task).map((item) => ({
        shortcuts: [item.shortcut],
        label: item.label,
        description: item.description,
        onClick: item.run,
        // Re-checking works on a whole selection, through the stage's shared limiter.
        ...(item.id === "recheck"
            ? {
                  multiSelectAllowed: true,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClickBatch: (tasks: Task<any>[]) => {
                      for (const t of tasks.filter(isTrackTask)) {
                          fire("Re-check", () => metadataLimiter.run(() => recheckMusicBrainz(t)));
                      }
                  },
              }
            : {}),
    }));
}
