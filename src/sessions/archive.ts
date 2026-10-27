import { Task } from "#base/task/task";
import { computeCompiledMetadata, CompiledMetadata } from "#flows/musicDownloadFlow/utils/compiledMetadata";
import { MusicDownloadTaskAttributes, TrackDownloadSource } from "#flows/musicDownloadFlow/types";
import { ArchivedTaskSnapshot, SessionTaskSnapshot, StoredSession } from "./types";

/** Display-ready view of one archived task, derived from its stored snapshot. */
export interface ArchivedEntry {
    sessionId: string;
    sessionName: string;
    archivedAt: string;
    task: SessionTaskSnapshot;
    taskId: string;
    kind: "track" | "collection";
    artist: string;
    title: string;
    /** Compiled metadata for tracks (undefined for collections). */
    compiled?: CompiledMetadata;
    /** Albums/playlists: archived child tracks, shown folded under this row. */
    childCount: number;
    /** Where the file was saved (falls back to the downloaded file) and when. */
    filePath?: string;
    savedAt?: string;
    /** `serviceKey` of every metadata platform that has a result, for the source badges. */
    metadataServiceKeys: string[];
    downloadProvider?: string;
    url: string;
}

type Derived = Omit<ArchivedEntry, "sessionId" | "sessionName" | "archivedAt" | "childCount">;

// Deriving compiled metadata walks every metadata group; the store re-emits on every
// persist, so cache per stored snapshot (immutable once archived).
const derivedCache = new WeakMap<ArchivedTaskSnapshot, Derived>();

function bestSource(sources: TrackDownloadSource[]): TrackDownloadSource | undefined {
    return (
        sources.find((s) => !s.isRejected && s.savedFile) ??
        sources.find((s) => !s.isRejected && s.localFile?.state === "found")
    );
}

function derive(entry: ArchivedTaskSnapshot): Derived {
    const cached = derivedCache.get(entry);
    if (cached) return cached;

    const task = entry.task;
    const attrs = task.attributes as MusicDownloadTaskAttributes | undefined;
    const url = attrs?.userInput?.url ?? task.initialInput ?? "";
    let derived: Derived;

    if (attrs?.kind === "collection") {
        derived = {
            task,
            taskId: task.id,
            kind: "collection",
            artist: attrs.ownerName ?? "",
            title: attrs.name ?? url,
            metadataServiceKeys: attrs.recognizedServiceKey ? [attrs.recognizedServiceKey] : [],
            url,
        };
    } else {
        let compiled: CompiledMetadata | undefined;
        try {
            compiled = attrs
                ? computeCompiledMetadata(attrs.metadataGroups ?? [], attrs.metadataOverride ?? {})
                : undefined;
        } catch {
            compiled = undefined; // malformed legacy snapshot — still list it by URL
        }
        const source = bestSource(attrs?.downloadSources ?? []);
        derived = {
            task,
            taskId: task.id,
            kind: "track",
            artist: compiled?.artists.map((a) => a.name).join(", ") ?? "",
            title: compiled?.trackName || url,
            compiled,
            filePath: source?.savedFile?.path ?? source?.localFile?.path,
            savedAt: source?.savedFile?.savedAt ? new Date(source.savedFile.savedAt).toISOString() : undefined,
            metadataServiceKeys: (attrs?.metadataGroups ?? [])
                .filter((g) => g.results.length > 0)
                .map((g) => g.serviceKey),
            downloadProvider: source?.provider,
            url,
        };
    }

    derivedCache.set(entry, derived);
    return derived;
}

/**
 * All archived tasks across every session, newest first. Children of an archived
 * collection are folded into their parent row (counted in `childCount`) so an album
 * doesn't flood the list; a child archived on its own still gets its own row.
 */
export function buildArchivedEntries(sessions: StoredSession[]): ArchivedEntry[] {
    const entries: ArchivedEntry[] = [];

    for (const session of sessions) {
        const archived = session.archived ?? [];
        if (archived.length === 0) continue;

        const childIdsByParent = new Map<string, Set<string>>();
        const foldedIds = new Set<string>();
        for (const a of archived) {
            const attrs = a.task.attributes as MusicDownloadTaskAttributes | undefined;
            if (attrs?.kind !== "collection") continue;
            const children = new Set(attrs.childTaskIds.filter((id) => archived.some((o) => o.task.id === id)));
            childIdsByParent.set(a.task.id, children);
            children.forEach((id) => foldedIds.add(id));
        }

        for (const a of archived) {
            if (foldedIds.has(a.task.id)) continue;
            entries.push({
                ...derive(a),
                sessionId: session.id,
                sessionName: session.name,
                archivedAt: a.archivedAt,
                childCount: childIdsByParent.get(a.task.id)?.size ?? 0,
            });
        }
    }

    return entries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

export function archivedEntryMatches(entry: ArchivedEntry, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
        entry.artist,
        entry.title,
        entry.sessionName,
        entry.url,
        entry.filePath,
        entry.compiled?.album?.albumName,
        entry.compiled?.isrc,
    ];
    return haystack.some((value) => value?.toLowerCase().includes(q));
}

/** Ids of every archived task across all sessions — for "already archived" import checks. */
export function getArchivedTaskIds(sessions: StoredSession[]): Set<string> {
    const ids = new Set<string>();
    for (const session of sessions) for (const a of session.archived ?? []) ids.add(a.task.id);
    return ids;
}

export function countArchived(sessions: StoredSession[]): number {
    return sessions.reduce((n, s) => n + (s.archived?.length ?? 0), 0);
}

// The queue is generic over task attributes; only music-download tasks are archived here.
type QueuedTask = Task<MusicDownloadTaskAttributes>;

/**
 * Ids of the idle tasks whose file has been saved — what "Archive saved" sweeps up.
 * An album/playlist counts once all of its (still queued) tracks are saved.
 */
export function findSavedTaskIds(tasks: Task[]): string[] {
    const queued = tasks as unknown as QueuedTask[];
    const byId = new Map(queued.map((t) => [t.getId(), t]));
    const isSaved = (t: QueuedTask): boolean => {
        const attrs = t.getAttributes();
        if (t.running || !attrs) return false;
        if (attrs.kind === "track") return attrs.downloadSources.some((s) => !s.isRejected && !!s.savedFile);
        const children = attrs.childTaskIds.map((id) => byId.get(id)).filter((c): c is QueuedTask => !!c);
        return children.length > 0 && children.every(isSaved);
    };
    return queued.filter(isSaved).map((t) => t.getId());
}
