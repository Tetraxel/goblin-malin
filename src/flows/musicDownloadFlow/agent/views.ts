import os from "node:os";
import { inkTransport } from "#base/logger/ink-transport";
import { type Task } from "#base/task/task";
import { CollectionTask } from "../utils/collectionTask";
import { DownloadTask } from "../utils/downloadTask";
import { computeCompiledMetadata, type CompiledMetadata } from "../utils/compiledMetadata";
import { downloadSourceIds } from "../utils/taskRevision";
import { isTaskRunning } from "./taskAccess";
import { type MetadataResultState, type TrackDownloadSource, type TrackDownloadTask } from "../types";

/**
 * What Claude sees of a task: compact, plain JSON, bounded. A view is data for the model to read, never an
 * instruction: titles, descriptions and logs are text other people wrote, so they are returned inside fields, never
 * spliced into prose the tool writes.
 */

export const LIST_PAGE_SIZE = 25;
export const LOG_PAGE_SIZE = 40;
const MAX_SOURCE_ROWS = 40;
const MAX_RESULTS_PER_PLATFORM = 5;
const MAX_CHILDREN = 100;
const MAX_TEXT = 300;

/**
 * Titles that carry video-site noise ("(Official Video)", "[Lyrics]", "(HD)") the saved file should not have. A
 * bracket counts only when **every** word in it is a noise word, so "(Full Circle)", "(Audio Bullys Remix)" or
 * "(Video Killed the Radio Star)" are real titles and stay untouched.
 */
export const TITLE_NOISE_PATTERN =
    /[([]\s*(?:(?:official|music|lyrics?|audio|video|visuali[sz]er|full|song|hd|hq|4k)\b\s*)+[)\]]/i;

export const TASK_PROBLEMS = ["no_source", "no_metadata", "title_noise", "needs_review", "not_saved"] as const;
export type TaskProblem = (typeof TASK_PROBLEMS)[number];

export type TaskFilter = {
    ids?: string[];
    query?: string;
    state?: string;
    kind?: "track" | "collection";
    problem?: TaskProblem;
};

const clip = (text: string | undefined, max = MAX_TEXT): string | undefined =>
    text === undefined ? undefined : text.length > max ? `${text.slice(0, max)}…` : text;

/** Hides the user's name and home folder from text that goes to Claude (paths in logs, file locations). */
export function maskPersonal(text: string): string {
    let out = text;
    const home = os.homedir();
    const user = (() => {
        try {
            return os.userInfo().username;
        } catch {
            return "";
        }
    })();
    const variants = [home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")].filter(Boolean);
    for (const v of new Set(variants)) {
        out = out.split(v).join("~");
        out = out.split(v.toLowerCase()).join("~");
    }
    if (user.length >= 3)
        out = out.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "<user>");
    return out;
}

/**
 * Free text of the app (a status, an error) as Claude may read it: the user's name and home folder hidden, then cut.
 * Masked BEFORE it is cut, so a name split by the cut cannot slip through half-written.
 */
export function safeText(text: string | undefined, max = MAX_TEXT): string | undefined {
    return text === undefined ? undefined : clip(maskPersonal(text), max);
}

function compiledOf(attrs: TrackDownloadTask): CompiledMetadata {
    return computeCompiledMetadata(attrs.metadataGroups ?? [], attrs.metadataOverride ?? {});
}

function titleOf(task: Task): string {
    const attrs = task.getAttributes() as { kind?: string; name?: string; userInput?: { url: string } } | undefined;
    if (attrs?.kind === "collection") return attrs.name ?? attrs.userInput?.url ?? task.getId();
    return compiledOf(task.getAttributes() as TrackDownloadTask).trackName || attrs?.userInput?.url || task.getId();
}

/** The row `list_tasks` returns for a task. */
export function summarizeTask(task: Task, locked: boolean): Record<string, unknown> {
    if (task instanceof CollectionTask) {
        const a = task.getAttributes()!;
        return {
            id: task.getId(),
            kind: "collection",
            collectionKind: a.collectionKind,
            state: a.state,
            name: clip(a.name),
            url: a.userInput.url,
            children: a.childTaskIds.length,
        };
    }
    const attrs = task.getAttributes() as TrackDownloadTask | undefined;
    if (!attrs) return { id: task.getId(), kind: "track", state: "pending" };
    const compiled = compiledOf(attrs);
    const selected = attrs.downloadSources.find((s) => s.selected);
    return {
        id: task.getId(),
        kind: "track",
        state: attrs.state,
        title: clip(compiled.trackName) ?? "",
        artists: compiled.artists.map((a) => clip(a.name, 100)),
        url: attrs.userInput.url,
        revision: task instanceof DownloadTask ? task.getRevision() : 0,
        platforms: attrs.metadataGroups.filter((g) => g.results.length > 0).map((g) => g.serviceKey),
        downloads: attrs.downloadSources.length,
        selectedProvider: selected?.provider,
        saved: !!attrs.savedFile,
        ...(locked ? { locked: true } : {}),
    };
}

/** Whether a task has the problem a filter asks about. */
export function hasProblem(task: Task, problem: TaskProblem): boolean {
    const attrs = task.getAttributes() as TrackDownloadTask | undefined;
    if (!attrs || attrs.kind !== "track") return false;
    const compiled = compiledOf(attrs);
    switch (problem) {
        case "no_source":
            return (
                attrs.downloadsFetched === true &&
                !attrs.downloadSources.some((s) => s.state === "downloaded" && !s.isRejected)
            );
        case "no_metadata":
            return compiled.trackName === "";
        case "title_noise":
            return TITLE_NOISE_PATTERN.test(compiled.trackName);
        case "needs_review":
            return attrs.musicBrainzIdentity?.verdict === "needsReview";
        case "not_saved":
            return !attrs.savedFile;
    }
}

/** The tasks matching a filter, in list order. */
export function filterTasks(tasks: readonly Task[], filter: TaskFilter): Task[] {
    // An id without its "task:" prefix names the same task (a model may drop it).
    const ids = filter.ids
        ? new Set(filter.ids.flatMap((id) => (id.startsWith("task:") ? [id] : [id, `task:${id}`])))
        : undefined;
    const query = filter.query?.trim().toLowerCase();
    return tasks.filter((task) => {
        if (ids && !ids.has(task.getId())) return false;
        const attrs = task.getAttributes() as { kind?: string; state?: string } | undefined;
        const kind = attrs?.kind === "collection" ? "collection" : "track";
        if (filter.kind && kind !== filter.kind) return false;
        if (filter.state && attrs?.state !== filter.state) return false;
        if (filter.problem && !hasProblem(task, filter.problem)) return false;
        if (query) {
            const a = task.getAttributes() as TrackDownloadTask | undefined;
            const hay =
                kind === "track" && a
                    ? [compiledOf(a).trackName, ...compiledOf(a).artists.map((x) => x.name), a.userInput.url]
                    : [titleOf(task), task.getInitialInput() ?? ""];
            if (!hay.some((h) => h.toLowerCase().includes(query))) return false;
        }
        return true;
    });
}

function resultView(r: MetadataResultState) {
    const m = r.metadata;
    return {
        uri: m.uri,
        url: m.url,
        title: clip(m.trackName),
        artists: m.artists.map((a) => clip(a.name, 100)),
        album: clip(m.album?.albumName),
        isrc: m.isrc,
        confidence: r.confidence,
        primary: r.isPrimaryInput || undefined,
        favorited: r.isFavorited || undefined,
        rejected: r.isRejected || undefined,
        addedByUser: r.addedByUser || undefined,
        foundBy: r.discoverySources.map((s) => s.discoveredBy),
        error: r.fetchState === "error" ? safeText(r.fetchError, 120) : undefined,
    };
}

/** What `get_source` rows look like: a download row as the model needs it to choose between them. */
export function sourceView(source: TrackDownloadSource, id: string) {
    return {
        id,
        provider: source.provider,
        state: source.state,
        selected: source.selected || undefined,
        rejected: source.isRejected || undefined,
        hasFile: source.localFile?.state === "found",
        format: source.fileInfo?.format,
        codec: source.fileInfo?.codec,
        bitrateKbps: source.fileInfo?.bitrateKbps,
        provenance: source.fileInfo?.provenance,
        sizeBytes: source.fileInfo?.sizeBytes ?? source.candidate?.sizeBytes,
        durationMs: source.fileInfo?.durationMs ?? source.candidate?.audio?.durationMs,
        remoteName: clip(source.candidate?.name, 160),
        from: clip(source.providerDetail, 80),
        note: clip(source.candidate?.note, 80),
    };
}

export function sourcesView(attrs: TrackDownloadTask) {
    const ids = downloadSourceIds(attrs.downloadSources);
    const rows = attrs.downloadSources.slice(0, MAX_SOURCE_ROWS).map((s, i) => sourceView(s, ids[i]));
    return {
        sources: rows,
        ...(attrs.downloadSources.length > MAX_SOURCE_ROWS
            ? { more: attrs.downloadSources.length - MAX_SOURCE_ROWS }
            : {}),
    };
}

/** The whole picture of one task for `get_task`. */
export function describeTask(task: Task, locked: boolean): Record<string, unknown> {
    if (task instanceof CollectionTask) {
        const a = task.getAttributes()!;
        return {
            ...summarizeTask(task as unknown as Task, locked),
            owner: clip(a.ownerName),
            totalCount: a.totalCount,
            childIds: a.childTaskIds.slice(0, MAX_CHILDREN),
            ...(a.childTaskIds.length > MAX_CHILDREN ? { moreChildren: a.childTaskIds.length - MAX_CHILDREN } : {}),
            error: safeText(a.error),
        };
    }
    const attrs = task.getAttributes() as TrackDownloadTask;
    const compiled = compiledOf(attrs);
    const saved = attrs.savedFile;
    return {
        ...summarizeTask(task, locked),
        // A part run again on a finished track counts (writes refuse it as running too).
        running: task instanceof DownloadTask ? isTaskRunning(task) : task.running || attrs.state === "running",
        compiled: {
            title: compiled.trackName,
            artists: compiled.artists.map((a) => a.name),
            album: compiled.album?.albumName,
            year: compiled.year,
            trackNumber: compiled.trackNumber,
            isrc: compiled.isrc,
            durationMs: compiled.duration,
            genres: compiled.genres,
            bpm: compiled.bpm,
            key: compiled.key,
            // Which platform each field came from ("manual" = an override).
            from: compiled.attribution,
        },
        overrides: attrs.metadataOverride,
        platforms: attrs.metadataGroups.map((g) => ({
            service: g.serviceKey,
            results: g.results.slice(0, MAX_RESULTS_PER_PLATFORM).map(resultView),
            ...(g.results.length > MAX_RESULTS_PER_PLATFORM
                ? { more: g.results.length - MAX_RESULTS_PER_PLATFORM }
                : {}),
        })),
        userSources: (attrs.userSources ?? []).map((s) => ({ url: s.url, uri: s.uri })),
        ...sourcesView(attrs),
        savedFile: saved
            ? { path: maskPersonal(saved.path), provider: saved.provider, savedAt: saved.savedAt }
            : undefined,
        musicBrainz: attrs.musicBrainzIdentity
            ? {
                  verdict: attrs.musicBrainzIdentity.verdict,
                  releaseId: attrs.musicBrainzIdentity.release?.id,
              }
            : undefined,
    };
}

export type LogsPage = {
    lines: { at: string; level: string; text: string }[];
    next?: string;
    total: number;
};

/** A page of one task's log, newest last, with the user's name and home folder hidden. `cursor` is an offset. */
export function taskLogs(task: Task, cursor: string | undefined, pageSize = LOG_PAGE_SIZE): LogsPage {
    const entries = inkTransport.filterLogs((e) => (e as { task?: unknown }).task === task);
    const start = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
    const slice = entries.slice(start, start + pageSize);
    const lines = slice.map((e) => {
        const entry = e as unknown as { timestamp?: Date; level?: string; message?: string };
        return {
            at: entry.timestamp ? new Date(entry.timestamp).toISOString() : "",
            level: String(entry.level ?? ""),
            text: safeText(String(entry.message ?? ""), 400) ?? "",
        };
    });
    const next = start + pageSize < entries.length ? String(start + pageSize) : undefined;
    return { lines, ...(next ? { next } : {}), total: entries.length };
}
