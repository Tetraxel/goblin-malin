import path from "path";
import { type TrackDownloadTask } from "../types";
import { stemCellState, stemKindsOf } from "../stems/stemFiles";
import { maskPersonal, safeText } from "./views";

/**
 * What Claude reads of a track's stems (P33): the separation runs, which run each stem uses, and what is saved. File
 * names only (the folders hold the user's name), and no progress tick that would change on every read.
 */
export function stemsView(attrs: TrackDownloadTask) {
    const runs = (attrs.stemRuns ?? []).map((run) => ({
        runId: run.id,
        model: run.model,
        modelLabel: run.modelLabel,
        device: run.device,
        state: run.state,
        madeFrom: run.input.kind === "saved" ? "the saved file" : "a download",
        ...(run.state === "separating" && run.progress !== undefined
            ? { progressPercent: Math.round(run.progress * 100) }
            : {}),
        ...(run.error ? { error: safeText(run.error, 300) } : {}),
        stems: run.stems.map((s) => ({ kind: s.kind, hasFile: s.state === "found" })),
    }));
    const stems = Object.fromEntries(
        stemKindsOf(attrs).map((kind) => {
            const cell = stemCellState(attrs, kind);
            return [
                kind,
                {
                    state: cell.state,
                    ...(cell.state === "temp" || cell.state === "tempMissing" ? { runId: cell.runId } : {}),
                    ...(cell.state === "saved"
                        ? { file: path.basename(cell.path), followsTrackName: cell.follows }
                        : {}),
                },
            ];
        })
    );
    const saved = Object.values(attrs.savedStems ?? {}).map((s) => ({
        kind: s.kind,
        file: path.basename(s.path),
        folder: maskPersonal(path.dirname(s.path)),
        model: s.model,
        runId: s.runId,
    }));
    return { runs, stems, saved };
}
