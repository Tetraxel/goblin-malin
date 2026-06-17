import { StoredSession, SessionTaskSnapshot } from "./types";

export function sessionMatchesQuery(session: StoredSession, q: string): boolean {
    if (!q) return true;
    const lower = q.toLowerCase();

    if (session.name.toLowerCase().includes(lower)) return true;

    for (const task of session.tasks) {
        const attrs = task.attributes;
        const url = attrs?.userInput?.url ?? task.initialInput ?? "";
        if (url.toLowerCase().includes(lower)) return true;

        for (const group of attrs?.metadataGroups ?? []) {
            for (const result of group.results) {
                if (result.metadata.trackName?.toLowerCase().includes(lower)) return true;
                for (const artist of result.metadata.artists ?? []) {
                    if (artist.name?.toLowerCase().includes(lower)) return true;
                }
            }
        }

        const override = attrs?.metadataOverride;
        if (override?.trackName?.toLowerCase().includes(lower)) return true;
        for (const artist of override?.artists ?? []) {
            if (artist.name?.toLowerCase().includes(lower)) return true;
        }
    }

    return false;
}

export function deriveSessionName(snapshots: SessionTaskSnapshot[]): string {
    const first = snapshots[0];
    if (!first) return `Session ${new Date().toLocaleDateString()}`;

    const attrs = first.attributes;
    if (attrs) {
        for (const group of attrs.metadataGroups) {
            const primary = group.results.find((r) => r.isPrimaryInput);
            const result = primary ?? group.results[0];
            if (result) {
                const artist = result.metadata.artists[0]?.name;
                const track = result.metadata.trackName;
                if (artist && track) return `${artist} – ${track}`;
                if (track) return track;
            }
        }
        const url = attrs.userInput?.url;
        if (url) return url;
    }

    const initialUrl = first.initialInput;
    if (initialUrl) return initialUrl;

    return `Session ${new Date().toLocaleDateString()}`;
}
