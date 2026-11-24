import { type StemKind, type StemRun, type TrackDownloadTask } from "#flows/musicDownloadFlow/types";
import { pickedStem } from "#flows/musicDownloadFlow/stems/stemFiles";
import { sortStemKinds, stemSetKinds } from "#flows/musicDownloadFlow/stems/stemKinds";

/** One line of the Stems tab's list. A row is found again by what it is (kind, run id), never by its position. */
export type StemRow =
    | { type: "layersHeader" }
    /** One layer of the player: the track ("original") or a stem. */
    | { type: "layer"; key: string }
    | { type: "savedHeader" }
    | { type: "saved"; kind: StemKind }
    | { type: "run"; runId: string }
    | { type: "stem"; runId: string; kind: StemKind };

/** A stable key for a row: what the cursor follows when the list changes under it. */
export function stemRowKey(row: StemRow): string {
    switch (row.type) {
        case "layersHeader":
            return "layers";
        case "layer":
            return `layer:${row.key}`;
        case "savedHeader":
            return "saved";
        case "saved":
            return `saved:${row.kind}`;
        case "run":
            return `run:${row.runId}`;
        case "stem":
            return `stem:${row.runId}:${row.kind}`;
    }
}

/** Whether the cursor can stop on a row (headers are only titles). */
export function isSelectable(row: StemRow): boolean {
    return row.type !== "savedHeader" && row.type !== "layersHeader";
}

/**
 * The rows of the Stems tab: the player's layers (`layerKeys`: the track, then each stem), the saved stems (what is
 * in the library), then the runs, newest first, each followed by its stems. `collapsed` run ids show their header only.
 */
export function buildStemRows(
    attrs: Pick<TrackDownloadTask, "stemRuns" | "savedStems" | "stemPick">,
    stemSet: string,
    collapsed: ReadonlySet<string>,
    layerKeys: readonly string[] = []
): StemRow[] {
    const set = stemSetKinds(stemSet);
    const rows: StemRow[] = [];
    if (layerKeys.length > 0) {
        rows.push({ type: "layersHeader" });
        for (const key of layerKeys) rows.push({ type: "layer", key });
    }
    const saved = sortStemKinds(Object.keys(attrs.savedStems ?? {}), set);
    if (saved.length > 0) {
        rows.push({ type: "savedHeader" });
        for (const kind of saved) rows.push({ type: "saved", kind });
    }
    const runs: StemRun[] = [...(attrs.stemRuns ?? [])].reverse();
    for (const run of runs) {
        rows.push({ type: "run", runId: run.id });
        if (collapsed.has(run.id)) continue;
        for (const kind of sortStemKinds(
            run.stems.map((s) => s.kind),
            set
        )) {
            rows.push({ type: "stem", runId: run.id, kind });
        }
    }
    return rows;
}

/** Whether a stem row is the file its stem uses now (the user's pick, or the newest run). */
export function isPickedRow(attrs: Pick<TrackDownloadTask, "stemRuns" | "stemPick">, row: StemRow): boolean {
    return row.type === "stem" && pickedStem(attrs, row.kind)?.run.id === row.runId;
}
