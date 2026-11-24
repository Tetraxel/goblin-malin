import fs from "fs/promises";
import * as path from "path";
import { type Logger } from "#base/logger/logger";
import { overwriteConfirmBridge } from "#base/bridges/overwriteConfirmBridge";
import { moveFile } from "#utils/metadata";
import { untilAborted } from "#utils/errors";
import {
    type Provenance,
    type SavedStem,
    type StemFile,
    type StemInput,
    type StemKind,
    type StemRun,
    type TrackDownloadTask,
} from "../types";
import { stemServiceRegistry } from "../registries";
import { getSaveSettings, getTempDownloadDir } from "../saveSettings";
import { computeCompiledMetadata } from "../utils/compiledMetadata";
import { compiledMetadataToTags } from "../utils/compiledMetadataToTags";
import { isOutputPathTaken, samePath } from "../utils/computeOutputPath";
import { convertAudioInto } from "../utils/convertAudio";
import { sanitizeFileNamePart } from "../utils/fileName";
import { extensionOf, parseOutputFormat, resolveOutputExtension } from "../utils/outputFormat";
import { readFileInfo } from "../utils/readFileInfo";
import { stemLimiter } from "../utils/stageLimiters";
import { tagAudioFile } from "../utils/tagAudioFile";
import { acquireDestinationLock, writeViaStaging } from "../utils/writeViaStaging";
import { stemKindRegistry } from "./stemKinds";
import { computeStemPath, pickedStem, stemInputFingerprint, stemKindsOf } from "./stemFiles";
import { getStemSettings } from "./stemProviders";
import { type SeparatedStem, type StemDevice, type StemProgress } from "./stemService";

/** What the stem operations need of a task (a `DownloadTask` fits). */
export interface StemHost {
    getId(): string;
    getAttributes(): TrackDownloadTask | undefined;
    updateAttributes(attributes: Partial<TrackDownloadTask>): void;
    getLogger(): Logger;
}

/** Progress is written onto the run at most this often: every write repaints the screen. */
const PROGRESS_INTERVAL_MS = 500;

/** Changes one run, found by its id (never its position: runs can be deleted meanwhile). */
export function updateStemRun(host: StemHost, runId: string, patch: Partial<StemRun>): void {
    const runs = host.getAttributes()?.stemRuns ?? [];
    if (!runs.some((r) => r.id === runId)) return;
    host.updateAttributes({ stemRuns: runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)) });
}

/** The file a separation reads now: the saved file, else the selected download. Throws why there is none. */
export async function resolveStemInput(
    attrs: TrackDownloadTask
): Promise<{ input: StemInput; provenance?: Provenance; durationMs: number }> {
    const exists = (file: string) => fs.stat(file).catch(() => undefined);
    const saved = attrs.savedFile;
    if (saved) {
        const stat = await exists(saved.path);
        if (stat) {
            return {
                input: { path: saved.path, kind: "saved", fingerprint: stemInputFingerprint(stat) },
                provenance: saved.fileInfo?.provenance,
                durationMs: saved.fileInfo?.durationMs ?? 0,
            };
        }
    }
    const selected = attrs.downloadSources.find((s) => s.selected && s.localFile?.state === "found");
    const downloadPath = selected?.localFile?.path;
    if (selected && downloadPath) {
        const stat = await exists(downloadPath);
        if (stat) {
            return {
                input: { path: downloadPath, kind: "download", fingerprint: stemInputFingerprint(stat) },
                provenance: selected.fileInfo?.provenance,
                durationMs: selected.fileInfo?.durationMs ?? 0,
            };
        }
    }
    throw new Error(
        saved
            ? `The saved file is not found (${saved.path}) and no downloaded source is selected`
            : "Nothing to separate yet: download the track (or select a downloaded source) first"
    );
}

/** The temp files of a run are named like the app's downloads (`… <uuid>.<stem>.flac`), so the clean-up knows them. */
function stemBaseName(attrs: TrackDownloadTask, runId: string): string {
    const compiled = computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride);
    const artist = compiled.artists[0]?.name ?? "Unknown Artist";
    const title = sanitizeFileNamePart(`${artist} - ${compiled.trackName || "Unknown Title"}`, 80) || "Track";
    return `Stems ${title} ${runId}`;
}

/**
 * Runs one separation (already added to `stemRuns` as "queued") to its end: waits its turn (one separation at a
 * time), separates, probes the stems, and writes the outcome on the run. Never throws: a failure or a stop is the
 * run's state.
 */
export async function executeStemRun(
    host: StemHost,
    runId: string,
    options: { provider: string; device: StemDevice; signal: AbortSignal; durationMs: number; provenance?: Provenance }
): Promise<void> {
    const logger = host.getLogger();
    const { signal } = options;
    // Set once the separation has its turn: a stop then waits for the program to end (and its files to be removed)
    // before the run is "stopped" and the task idle. A run still waiting its turn is let go at once.
    let started = false;
    const work = stemLimiter.run(async () => {
        if (signal.aborted) return;
        started = true;
        const attrs = host.getAttributes();
        const run = attrs?.stemRuns?.find((r) => r.id === runId);
        if (!attrs || !run) return;
        const factory = stemServiceRegistry.getFactories().get(options.provider);
        if (!factory) throw new Error(`No stem separation provider "${options.provider}"`);
        const service = factory(host as never, logger);

        updateStemRun(host, runId, { state: "separating", progress: 0, progressText: "Starting" });
        logger.info(`Separating stems with ${run.model} (${options.device}) from ${run.input.path}`);

        let lastWrite = 0;
        let latest: StemProgress | undefined;
        let timer: NodeJS.Timeout | undefined;
        const flush = () => {
            timer = undefined;
            lastWrite = Date.now();
            if (latest && !signal.aborted)
                updateStemRun(host, runId, { progress: latest.fraction, progressText: latest.text });
        };
        const onProgress = (p: StemProgress) => {
            latest = p;
            if (timer) return;
            const wait = PROGRESS_INTERVAL_MS - (Date.now() - lastWrite);
            if (wait <= 0) flush();
            else timer = setTimeout(flush, wait);
        };

        const outDir = getTempDownloadDir();
        await fs.mkdir(outDir, { recursive: true });
        let separated: SeparatedStem[];
        try {
            separated = await service.separate({
                input: run.input.path,
                model: run.model,
                device: options.device,
                outDir,
                baseName: stemBaseName(attrs, runId),
                signal,
                onProgress,
            });
        } finally {
            clearTimeout(timer);
        }
        // Stopped as the program finished: its stems are not this run's (the run is "stopped").
        const dropIfStopped = async () => {
            if (!signal.aborted) return false;
            await Promise.all(separated.map((s) => fs.rm(s.path, { force: true })));
            return true;
        };
        if (await dropIfStopped()) return;

        const stems: StemFile[] = await Promise.all(
            separated.map(async (s): Promise<StemFile> => {
                const fileInfo = await readFileInfo(s.path, options.durationMs, options.provenance ?? "lossless").catch(
                    () => undefined
                );
                return { kind: s.kind, path: s.path, state: "found", fileInfo };
            })
        );
        if (await dropIfStopped()) return;
        updateStemRun(host, runId, {
            state: "done",
            stems,
            progress: undefined,
            progressText: undefined,
            finishedAt: new Date(),
        });
        logger.info(`Stems separated with ${run.model}: ${stems.map((s) => s.kind).join(", ")}`);
    });
    try {
        await untilAborted(work, signal);
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    } catch (error) {
        const stopped = signal.aborted || (error as Error)?.name === "AbortError";
        // The program reacts to the stop: wait until it has ended and cleaned its folder.
        if (stopped && started) await work.catch(() => {});
        const message = error instanceof Error ? error.message : String(error);
        if (stopped) logger.info("Stem separation stopped");
        else logger.error(`Stem separation failed: ${message}`);
        updateStemRun(host, runId, {
            state: stopped ? "stopped" : "failed",
            error: stopped ? undefined : message,
            progress: undefined,
            progressText: undefined,
            finishedAt: new Date(),
        });
    }
}

/** The format stems are saved in: the one tracks are converted to, else FLAC (what the separation wrote). */
function stemExtension(): string {
    return resolveOutputExtension(getSaveSettings(), "stem.flac");
}

/**
 * Saves stems next to the track's saved file (`kinds`: all the track has a file for, when left out). Each comes from
 * its picked run; converted to the saved format when it differs; tagged with the track's tags when Settings says so.
 * A stem saved before under another name (the track was renamed) is replaced, and its old file deleted unless the
 * user relocated it. Returns the kinds saved; throws when nothing could be (no saved track, no file).
 */
export async function saveStemFiles(host: StemHost, kinds?: StemKind[]): Promise<StemKind[]> {
    const attrs = host.getAttributes();
    if (!attrs) throw new Error("No track");
    const parent = attrs.savedFile;
    if (!parent) throw new Error("Save the track first: its stems are named after its file");
    const settings = getStemSettings();
    const wanted = kinds ?? stemKindsOf(attrs).filter((kind) => pickedStem(attrs, kind));
    const extension = stemExtension();
    const compiled = computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride);
    const baseTags = compiledMetadataToTags(compiled, { includeMusicBrainzTags: false });
    const logger = host.getLogger();
    const saved: StemKind[] = [];
    const failures: string[] = [];

    for (const kind of wanted) {
        const picked = pickedStem(host.getAttributes() ?? attrs, kind);
        if (!picked || picked.stem.state !== "found") {
            failures.push(`${stemKindRegistry.get(kind).label}: no separated file`);
            continue;
        }
        const previous = host.getAttributes()?.savedStems?.[kind];
        const dest = computeStemPath(parent.path, kind, settings.fileNameTemplate, extension);
        const release = await acquireDestinationLock(dest);
        try {
            if ((await isOutputPathTaken(dest, [previous?.path])) && !(await overwriteConfirmBridge.confirm(dest))) {
                failures.push(`${stemKindRegistry.get(kind).label}: ${path.basename(dest)} exists and was kept`);
                continue;
            }
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await writeViaStaging(dest, async (staging) => {
                if (extensionOf(picked.stem.path) === extension) await fs.copyFile(picked.stem.path, staging);
                else await convertAudioInto(picked.stem.path, staging, parseOutputFormat(extension));
                if (settings.tagStems) {
                    const label = stemKindRegistry.get(kind).label;
                    await tagAudioFile(staging, { ...baseTags, trackTitle: `${baseTags.trackTitle} (${label})` });
                }
            });
            // The stem it replaces, saved under another name: deleted, unless the user moved it somewhere of theirs.
            if (previous && !samePath(previous.path, dest) && samePath(previous.path, previous.writtenPath)) {
                await fs.unlink(previous.path).catch(() => {});
            }
            const record: SavedStem = {
                kind,
                path: dest,
                writtenPath: dest,
                savedAt: new Date(),
                runId: picked.run.id,
                model: picked.run.model,
                parentPath: parent.path,
                fileInfo: picked.stem.fileInfo,
            };
            host.updateAttributes({ savedStems: { ...host.getAttributes()?.savedStems, [kind]: record } });
            saved.push(kind);
        } catch (error) {
            failures.push(`${stemKindRegistry.get(kind).label}: ${error instanceof Error ? error.message : error}`);
        } finally {
            release();
        }
    }
    if (saved.length > 0) logger.info(`Stems saved: ${saved.join(", ")}`);
    if (failures.length > 0) {
        logger.warn(`Some stems were not saved: ${failures.join("; ")}`);
        if (saved.length === 0) throw new Error(failures.join("; "));
    }
    return saved;
}

/** Deletes a run's temporary files (its saved stems are copies in the library and stay). */
export async function deleteStemRunFiles(run: StemRun): Promise<void> {
    await Promise.all(run.stems.map((stem) => fs.rm(stem.path, { force: true })));
}

/**
 * Moves the saved stems that no longer follow the track's file to the names they would get now. A stem the user moved
 * somewhere of their own stays where it is. Each record is written as soon as its file has moved, so a failure half-way
 * never leaves a record pointing at a file that is gone. Returns how many moved; throws when some could not be.
 */
export async function renameSavedStems(host: StemHost): Promise<number> {
    const attrs = host.getAttributes();
    const parent = attrs?.savedFile;
    if (!attrs || !parent) throw new Error("The track is not saved");
    const settings = getStemSettings();
    let moved = 0;
    const failures: string[] = [];
    for (const [kind, stem] of Object.entries(attrs.savedStems ?? {})) {
        if (stem.parentPath && samePath(stem.parentPath, parent.path)) continue;
        if (stem.writtenPath && !samePath(stem.path, stem.writtenPath)) continue;
        const dest = computeStemPath(parent.path, kind, settings.fileNameTemplate, extensionOf(stem.path) || "flac");
        try {
            if (!samePath(dest, stem.path)) {
                if (await isOutputPathTaken(dest, [stem.path])) throw new Error(`${dest} already exists`);
                await moveFile(stem.path, dest);
            }
            const record: SavedStem = { ...stem, path: dest, writtenPath: dest, parentPath: parent.path };
            host.updateAttributes({ savedStems: { ...host.getAttributes()?.savedStems, [kind]: record } });
            moved++;
        } catch (error) {
            failures.push(`${stemKindRegistry.get(kind).label}: ${error instanceof Error ? error.message : error}`);
        }
    }
    if (failures.length > 0) {
        const message = failures.join("; ");
        if (moved === 0) throw new Error(message);
        host.getLogger().warn(`Some stems were not renamed: ${message}`);
    }
    return moved;
}
