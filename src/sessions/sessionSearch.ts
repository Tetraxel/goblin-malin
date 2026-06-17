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

export interface SessionMatch {
    field: string; // "Track" | "Artist" | "URL"
    value: string;
}

/**
 * Collects the distinct task-level fields (track/artist/url) that contain `q`,
 * so the modal can show *why* a session matched. The session name is excluded —
 * it's highlighted in the row title instead. Capped to keep rows compact.
 */
export function getSessionMatches(session: StoredSession, q: string, limit = 4): SessionMatch[] {
    const lower = q.trim().toLowerCase();
    if (!lower) return [];

    const matches: SessionMatch[] = [];
    const seen = new Set<string>();
    const add = (field: string, value: string | undefined | null): void => {
        if (!value || matches.length >= limit) return;
        if (!value.toLowerCase().includes(lower)) return;
        const key = `${field}:${value}`;
        if (seen.has(key)) return;
        seen.add(key);
        matches.push({ field, value });
    };

    for (const task of session.tasks) {
        if (matches.length >= limit) break;
        const attrs = task.attributes;
        add("URL", attrs?.userInput?.url ?? task.initialInput);
        for (const group of attrs?.metadataGroups ?? []) {
            for (const result of group.results) {
                add("Track", result.metadata.trackName);
                for (const artist of result.metadata.artists ?? []) add("Artist", artist.name);
            }
        }
        add("Track", attrs?.metadataOverride?.trackName);
        for (const artist of attrs?.metadataOverride?.artists ?? []) add("Artist", artist.name);
    }

    return matches;
}

/**
 * Trims `value` to ~`max` chars while keeping the matched substring visible,
 * adding ellipses where text was dropped.
 */
export function clampToMatch(value: string, query: string, max: number): string {
    if (max <= 1 || value.length <= max) return value;
    const idx = value.toLowerCase().indexOf(query.trim().toLowerCase());
    if (idx < 0 || idx + query.trim().length <= max - 1) return value.slice(0, max - 1) + "…";
    const start = Math.max(0, idx - 8);
    return "…" + value.slice(start, start + max - 2);
}

export function deriveSessionName(snapshots: SessionTaskSnapshot[]): string {
    const first = snapshots[0];
    if (!first) return `Session ${new Date().toLocaleDateString("en-US")}`;

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

    return `Session ${new Date().toLocaleDateString("en-US")}`;
}
