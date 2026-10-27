import { useEffect, useMemo, useState } from "react";
import { SessionStore } from "#sessions/sessionStore";
import { ArchivedEntry, archivedEntryMatches, buildArchivedEntries, countArchived } from "#sessions/archive";

/** Every archived task across all sessions, filtered by `query`. Re-renders when the store changes. */
export function useArchive(query: string): { entries: ArchivedEntry[]; total: number } {
    const store = SessionStore.getInstance();
    const [sessions, setSessions] = useState(() => store.getAll());

    useEffect(() => store.onChanged(() => setSessions(store.getAll())), [store]);

    const all = useMemo(() => buildArchivedEntries(sessions), [sessions]);
    const entries = useMemo(() => all.filter((e) => archivedEntryMatches(e, query)), [all, query]);
    return { entries, total: all.length };
}

/** Total archived-task count across all sessions, for the toolbar badge. */
export function useArchivedCount(): number {
    const store = SessionStore.getInstance();
    const [count, setCount] = useState(() => countArchived(store.getAll()));

    useEffect(() => store.onChanged(() => setCount(countArchived(store.getAll()))), [store]);

    return count;
}
