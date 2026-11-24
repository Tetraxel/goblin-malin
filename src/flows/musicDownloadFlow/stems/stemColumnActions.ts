import { type ContextualActions } from "#types/actions";
import { type Task } from "#base/task/task";
import { dialogBridge } from "#base/bridges/dialogBridge";
import { globalLogger } from "#base/logger/logger";
import { type MusicDownloadTaskAttributes, type StemKind } from "../types";
import { TaskLockedError, type DownloadTask } from "../utils/downloadTask";
import { stemCellState, stemLayers } from "./stemFiles";
import { stemKindRegistry, stemSetKinds } from "./stemKinds";
import { activeStemProvider, getStemSettings } from "./stemProviders";
import { playLayer } from "./layerPlayback";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isTrack = (t: Task<any>): t is DownloadTask =>
    (t.getAttributes() as MusicDownloadTaskAttributes | undefined)?.kind === "track";

function explain(title: string, error: unknown): void {
    if (error instanceof TaskLockedError) {
        globalLogger.info(error.message);
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    globalLogger.warn(`${title}: ${message}`);
    void dialogBridge.confirm({ title, message, choices: [{ label: "OK", tone: "primary" }] });
}

/**
 * Starts a separation of each track (with the default model). One at a time: the others wait their turn. Refusals
 * (stem separation off, nothing downloaded) are told once, not once per track.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function separateStemsOf(tasks: Task<any>[]): Promise<void> {
    const reasons = new Map<string, number>();
    let started = 0;
    for (const task of tasks.filter(isTrack)) {
        try {
            await task.startStemSeparation();
            started++;
        } catch (error) {
            if (error instanceof TaskLockedError) continue;
            const reason = error instanceof Error ? error.message : String(error);
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        }
    }
    if (started > 0) globalLogger.info(`Stem separation queued for ${started} track${started === 1 ? "" : "s"}`);
    if (reasons.size > 0) {
        const lines = [...reasons].map(([reason, n]) => (n > 1 ? `${reason} (${n} tracks)` : reason));
        explain(
            started > 0 ? "Some tracks were not separated" : "Stems cannot be separated",
            new Error(lines.join("\n"))
        );
    }
}

/**
 * "Separate stems" on the task row (any column, any view) while stem separation is on: the track's own separation,
 * or the selection's. Not on an album or playlist row (its tracks are separated one by one).
 */
export function buildSeparateStemsAction(task: DownloadTask): ContextualActions[] {
    if (!activeStemProvider()) return [];
    return [
        {
            shortcuts: [{ input: "b" }],
            label: "Separate stems",
            description: "Split the track into stems with the default model (on this computer)",
            multiSelectAllowed: true,
            onClick: () => void separateStemsOf([task]),
            onClickBatch: (tasks) => void separateStemsOf(tasks),
        },
    ];
}

/**
 * The actions of a stem's column in the Stems view: play the stem (on the track's timeline: from where its other
 * layers are, see `layerPlayback.ts`) and save the stems. Separating is on the task row.
 */
export function buildStemColumnActions(kind: StemKind, task: DownloadTask): ContextualActions[] {
    const attrs = task.getAttributes();
    const cell = attrs ? stemCellState(attrs, kind) : undefined;
    const file = cell?.state === "saved" || cell?.state === "temp" ? cell.path : undefined;
    const label = stemKindRegistry.get(kind).label;
    const actions: ContextualActions[] = [];
    if (file && attrs) {
        const input =
            attrs.savedFile?.path ??
            attrs.downloadSources.find((s) => s.selected && s.localFile?.state === "found")?.localFile?.path;
        const layerFiles = stemLayers(attrs, stemSetKinds(getStemSettings().stemSet), { path: input }).map(
            (l) => l.path
        );
        actions.push({
            shortcuts: [{ key: "return" }],
            label: "Play stem",
            description: `Play or pause the ${label.toLowerCase()} stem`,
            runOnCellClick: true,
            onClick: () => playLayer(file, layerFiles),
        });
    }
    if (attrs?.savedFile && (attrs.stemRuns ?? []).some((r) => r.state === "done")) {
        actions.push({
            shortcuts: [{ input: "a" }],
            label: "Save stems",
            description: "Save the stems next to the track's file",
            onClick: () => {
                task.saveStems().then(
                    (kinds) => globalLogger.info(`Saved ${kinds.length} stem${kinds.length === 1 ? "" : "s"}`),
                    (error: unknown) => explain("Stems not saved", error)
                );
            },
        });
    }
    return actions;
}
