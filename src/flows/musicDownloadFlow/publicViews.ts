import { type Task } from "#base/task/task";
import { computeCompiledMetadata } from "./utils/compiledMetadata";
import { compiledFieldValues } from "./utils/metadataFields";
import { downloadSourceIds } from "./utils/taskRevision";
import { type CollectionDownloadTask, type MusicDownloadTaskAttributes, type TrackDownloadTask } from "./types";
import type { CollectionView, DownloadView, SourceView, TaskView, TrackView } from "#extensions/api/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTask = Task<any>;

/**
 * What code outside the app (extensions, P34) sees of a task: a frozen plain object built from its attributes, never
 * the live task. One definition, used by `goblin.tasks` and by the event payloads.
 *
 * Only type imports of the task classes: the pipeline emits events with these views, so this module must not pull
 * the classes in (a cycle).
 */

function extensionOf(filePath: string): string {
    const dot = filePath.lastIndexOf(".");
    return dot === -1 ? "" : filePath.slice(dot + 1).toLowerCase();
}

function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    }
    return value;
}

function statusOf(task: AnyTask): string | undefined {
    try {
        return task.getStatus().get().message || undefined;
    } catch {
        return undefined;
    }
}

function trackViewOf(task: AnyTask, attrs: TrackDownloadTask): TrackView {
    const compiled = computeCompiledMetadata(attrs.metadataGroups ?? [], attrs.metadataOverride ?? {});
    const sources: SourceView[] = [];
    for (const group of attrs.metadataGroups ?? []) {
        for (const result of group.results ?? []) {
            const m = result.metadata;
            if (!m) continue;
            sources.push({
                platform: group.serviceKey,
                url: m.url,
                title: m.trackName,
                artists: (m.artists ?? []).map((a) => a.name),
                album: m.album?.albumName,
                isrc: m.isrc,
                durationMs: m.duration,
                primary: result.isPrimaryInput,
                rejected: result.isRejected,
                addedByUser: !!result.addedByUser,
            });
        }
    }
    const rows = attrs.downloadSources ?? [];
    const ids = downloadSourceIds(rows);
    const downloads: DownloadView[] = rows.map((row, i) => {
        const info = row.fileInfo;
        return {
            id: ids[i],
            provider: row.provider,
            state: row.state,
            selected: row.selected,
            rejected: !!row.isRejected,
            path: row.localFile?.state === "found" ? row.localFile.path : undefined,
            format: info?.format ?? row.localFile?.extension,
            bitrateKbps: info?.bitrateKbps,
            sizeBytes: info?.sizeBytes,
        };
    });
    const saved = attrs.savedFile;
    const stems: Record<string, string> = {};
    for (const [kind, stem] of Object.entries(attrs.savedStems ?? {})) stems[kind] = stem.path;
    return {
        id: task.getId(),
        kind: "track",
        state: attrs.state,
        status: statusOf(task),
        busy: task.isBusy(),
        url: attrs.userInput?.url ?? "",
        platform: attrs.recognizedServiceKey,
        parentId: attrs.parentTaskId,
        title: compiled.trackName || undefined,
        artists: compiled.artists.map((a) => a.name),
        album: compiled.album?.albumName,
        isrc: compiled.isrc,
        durationMs: compiled.duration,
        year: compiled.year,
        trackNumber: compiled.trackNumber,
        // A copy: the view is frozen, and the compiled value may be the very array of the track's override.
        genres: [...(compiled.genres ?? [])],
        fields: compiledFieldValues(compiled),
        overrides: structuredClone(attrs.metadataOverride ?? {}),
        sources,
        downloads,
        savedFile: saved
            ? {
                  path: saved.path,
                  format: saved.converted?.format ?? extensionOf(saved.path),
                  savedAt: new Date(saved.savedAt).toISOString(),
                  provider: saved.provider,
              }
            : undefined,
        stems,
    };
}

function collectionViewOf(task: AnyTask, attrs: CollectionDownloadTask): CollectionView {
    return {
        id: task.getId(),
        kind: "collection",
        collectionKind: attrs.collectionKind,
        state: attrs.state,
        status: statusOf(task),
        busy: task.isBusy(),
        url: attrs.userInput?.url ?? "",
        platform: attrs.recognizedServiceKey,
        name: attrs.name,
        childIds: [...(attrs.childTaskIds ?? [])],
    };
}

/** The view of any task of the list; undefined for a task with no attributes (it never got any). */
export function taskView(task: AnyTask): TaskView | undefined {
    const attrs = task.getAttributes() as MusicDownloadTaskAttributes | undefined;
    if (!attrs) return undefined;
    const view = attrs.kind === "collection" ? collectionViewOf(task, attrs) : trackViewOf(task, attrs);
    return deepFreeze(view);
}

export function trackView(task: AnyTask): TrackView {
    const view = taskView(task);
    if (!view || view.kind !== "track") throw new Error(`${task.getId()} is not a track`);
    return view;
}

export function collectionView(task: AnyTask): CollectionView {
    const view = taskView(task);
    if (!view || view.kind !== "collection") throw new Error(`${task.getId()} is not a collection`);
    return view;
}
