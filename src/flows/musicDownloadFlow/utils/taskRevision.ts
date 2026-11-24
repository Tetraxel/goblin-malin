import { type TrackDownloadSource, type TrackDownloadTask } from "#flows/musicDownloadFlow/types";

/**
 * The id of each download row of a track, in order. A row is told apart by who made it and what it is (the
 * provider, the peer, the remote file name or the page it came from), not by its position: positions shift when a
 * provider is retried. Two rows that would share an id (the same file twice) get a `#2`, `#3`… suffix.
 */
export function downloadSourceIds(sources: readonly TrackDownloadSource[]): string[] {
    const seen = new Map<string, number>();
    return sources.map((s) => {
        // Only what is there from the row's first appearance to its end: `localFile` appears when the download
        // finishes, so reading it (its `sourceUrl` is the track's own url anyway) would change the id mid-run.
        const what = s.candidate?.name ?? s.track.uri ?? s.track.url;
        const base = [s.provider, s.providerDetail ?? "", what ?? ""].join("|");
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        return n === 1 ? base : `${base}#${n}`;
    });
}

/** Keys sorted, so two overrides with the same content always give the same text. */
function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/** 32-bit FNV-1a: enough to tell "the same" from "changed", and the same on every run. */
function hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * The revision of a track: a number that changes whenever what the USER can edit changes, and only then. It is
 * what a write carries ("I read revision 12") so a write based on an out-of-date read is refused.
 *
 * It covers: the metadata overrides, the links the user added, the favorite/rejected choice of every metadata
 * result, the download rows (which ones exist, which is selected, which are rejected) and the collection the track is
 * in (`parentTaskId`: a group the user put it in). It deliberately does
 * NOT cover status or progress: those change on every tick of a download, and would make every write stale.
 *
 * It is a fingerprint rather than a counter, so it is the same after a restart and cannot drift: going A → B → A
 * gives A's revision again, which is right, since what a reader of A saw is true again.
 */
export function computeTaskRevision(attrs: TrackDownloadTask): number {
    const results = attrs.metadataGroups.flatMap((g) =>
        g.results.map(
            (r) =>
                `${g.serviceKey}:${r.metadata.uri ?? r.metadata.url}:${+r.isFavorited}${+r.isRejected}${+!!r.addedByUser}`
        )
    );
    const ids = downloadSourceIds(attrs.downloadSources);
    const rows = attrs.downloadSources.map((s, i) => `${ids[i]}:${+s.selected}${+!!s.isRejected}`);
    return hash(
        [
            stable(attrs.metadataOverride ?? {}),
            (attrs.userSources ?? []).map((s) => s.uri).join(","),
            results.join(","),
            rows.join(","),
            attrs.parentTaskId ?? "",
            // Stems (P33): which runs exist and which one each stem uses. Not the runs' progress.
            (attrs.stemRuns ?? []).map((r) => r.id).join(","),
            stable(attrs.stemPick ?? {}),
        ].join("\n")
    );
}
