import * as path from "path";
import { type StemFile, type StemKind, type StemRun, type TrackDownloadTask } from "../types";
import { sanitizeFileNamePart } from "../utils/fileName";
import { samePath } from "../utils/computeOutputPath";
import { stemKindRegistry } from "./stemKinds";

/** What a stem's file name is made from, when Settings has nothing usable. */
export const DEFAULT_STEM_TEMPLATE = "{name} ({Stem})";

/** `size:mtime` of the file a run read: a run whose input changed since is "made from an older file". */
export function stemInputFingerprint(stat: { size: number; mtimeMs: number }): string {
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

/**
 * Where a stem of the track saved at `parentPath` is saved: the template (`{name}` the track's file name without its
 * extension, `{stem}` / `{Stem}` the stem's name, a `/` for a sub-folder), in the track's folder, with `extension`.
 * Every part is cleaned like a track's file name; a template that gives nothing falls back to the default one.
 */
export function computeStemPath(parentPath: string, kind: StemKind, template: string, extension: string): string {
    const name = path.basename(parentPath, path.extname(parentPath));
    const label = stemKindRegistry.get(kind).label;
    const fill = (t: string) =>
        t
            .replace(/\{name\}/g, name)
            .replace(/\{Stem\}/g, label)
            .replace(/\{stem\}/g, kind);
    const build = (t: string) =>
        fill(t)
            .split(/[\\/]/)
            .map((part) => sanitizeFileNamePart(part.trim()))
            .filter((part) => part && part !== "." && part !== "..");
    let parts = build(template.trim() || DEFAULT_STEM_TEMPLATE);
    // A template without `{stem}` would give every stem the same name.
    if (parts.length === 0 || !/\{stem\}/i.test(template)) parts = build(DEFAULT_STEM_TEMPLATE);
    return path.join(path.dirname(parentPath), ...parts) + `.${extension}`;
}

/** Every stem kind a track has: in a run or saved. */
export function stemKindsOf(attrs: Pick<TrackDownloadTask, "stemRuns" | "savedStems">): StemKind[] {
    const kinds = new Set<StemKind>();
    for (const run of attrs.stemRuns ?? []) for (const stem of run.stems) kinds.add(stem.kind);
    for (const kind of Object.keys(attrs.savedStems ?? {})) kinds.add(kind);
    return [...kinds];
}

export function isStemRunActive(run: StemRun): boolean {
    return run.state === "queued" || run.state === "separating";
}

/**
 * The run a stem's file comes from: the one the user picked, else the newest finished run that has that stem. The
 * file may be gone (`state: "not_found"`).
 */
export function pickedStem(
    attrs: Pick<TrackDownloadTask, "stemRuns" | "stemPick">,
    kind: StemKind
): { run: StemRun; stem: StemFile } | undefined {
    const runs = attrs.stemRuns ?? [];
    const withStem = (run: StemRun | undefined) => {
        const stem = run?.state === "done" ? run.stems.find((s) => s.kind === kind) : undefined;
        return run && stem ? { run, stem } : undefined;
    };
    const picked = attrs.stemPick?.[kind];
    if (picked) {
        const found = withStem(runs.find((r) => r.id === picked));
        if (found) return found;
    }
    for (let i = runs.length - 1; i >= 0; i--) {
        const found = withStem(runs[i]);
        if (found) return found;
    }
    return undefined;
}

/** What one stem of a track is, for its cell in the Stems view (and Claude's view of it). */
export type StemCellState =
    | { state: "none" }
    | { state: "queued" }
    | { state: "separating"; progress?: number; text?: string }
    | { state: "failed"; error?: string }
    | { state: "temp"; path: string; runId: string }
    | { state: "tempMissing"; path: string; runId: string }
    | { state: "saved"; path: string; follows: boolean };

/**
 * The state of one stem. A saved stem wins (it is the user's file); then a run in progress; then the picked file of
 * a finished run; then a failure of the newest run. `follows` is false when the track was saved under another name
 * since the stem was saved ("name does not follow the track").
 */
export function stemCellState(
    attrs: Pick<TrackDownloadTask, "stemRuns" | "stemPick" | "savedStems" | "savedFile">,
    kind: StemKind
): StemCellState {
    const saved = attrs.savedStems?.[kind];
    if (saved) {
        const follows = !saved.parentPath || !attrs.savedFile || samePath(saved.parentPath, attrs.savedFile.path);
        return { state: "saved", path: saved.path, follows };
    }
    const runs = attrs.stemRuns ?? [];
    const active = [...runs].reverse().find(isStemRunActive);
    if (active) {
        return active.state === "queued"
            ? { state: "queued" }
            : { state: "separating", progress: active.progress, text: active.progressText };
    }
    const picked = pickedStem(attrs, kind);
    if (picked) {
        return picked.stem.state === "found"
            ? { state: "temp", path: picked.stem.path, runId: picked.run.id }
            : { state: "tempMissing", path: picked.stem.path, runId: picked.run.id };
    }
    const last = runs[runs.length - 1];
    if (last?.state === "failed") return { state: "failed", error: last.error };
    return { state: "none" };
}

/** Whether a run read another file than the one the track would be separated from now (it was saved again since). */
export function isStemRunStale(run: StemRun, currentFingerprint: string | undefined, currentPath?: string): boolean {
    if (currentPath && !samePath(run.input.path, currentPath)) return true;
    return currentFingerprint !== undefined && run.input.fingerprint !== currentFingerprint;
}

/** A short line about a run: "htdemucs_ft · 4 stems · 39 s". */
export function describeStemRun(run: StemRun): string {
    const parts = [run.modelLabel ?? run.model];
    if (run.device) parts.push(run.device.toUpperCase());
    if (run.state === "done") parts.push(`${run.stems.length} stem${run.stems.length === 1 ? "" : "s"}`);
    if (run.finishedAt) {
        const seconds = Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000));
        parts.push(seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`);
    }
    return parts.join(" · ");
}

/** One layer of the Stems tab's player: the track itself, or one stem. */
export type StemLayer = {
    /** "original", or the stem's kind. */
    key: string;
    kind?: StemKind;
    /** The file it plays: the saved stem, else the picked run's file; `undefined` while there is none. */
    path?: string;
    /** What the file was probed as, for its length before it is loaded. */
    durationMs?: number;
};

/**
 * The layers of the player, top to bottom: the track (`originalPath`: its saved file, else the selected download),
 * then one per stem of the set and any other stem the track has. A layer without a file is still listed (empty), so
 * the stems are always in the same place.
 */
export function stemLayers(
    attrs: Pick<TrackDownloadTask, "stemRuns" | "stemPick" | "savedStems">,
    set: readonly StemKind[],
    original: { path?: string; durationMs?: number }
): StemLayer[] {
    const extra = stemKindsOf(attrs).filter((kind) => !set.includes(kind));
    const layers: StemLayer[] = [{ key: "original", path: original.path, durationMs: original.durationMs }];
    for (const kind of [...set, ...extra.sort()]) {
        const saved = attrs.savedStems?.[kind];
        const picked = pickedStem(attrs, kind);
        const path = saved?.path ?? (picked?.stem.state === "found" ? picked.stem.path : undefined);
        layers.push({
            key: kind,
            kind,
            path,
            durationMs: saved?.fileInfo?.durationMs ?? picked?.stem.fileInfo?.durationMs,
        });
    }
    return layers;
}
