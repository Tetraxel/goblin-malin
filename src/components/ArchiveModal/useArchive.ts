import { useEffect, useMemo, useState } from "react";
import { SessionStore } from "#sessions/sessionStore";
import { SessionManager } from "#sessions/sessionManager";
import { StoredSession } from "#sessions/types";
import { ArchivedEntry, archivedEntryMatches, buildArchivedEntries, countArchived } from "#sessions/archive";

/**
 * The current session's stored record. Re-reads when the store changes (archive/restore/persist)
 * and when the manager switches session (new/load), so the archive always follows the session.
 */
function useCurrentSession(): StoredSession | undefined {
    const store = SessionStore.getInstance();
    const manager = SessionManager.getInstance();
    const [session, setSession] = useState(() => manager.getCurrentSession());

    useEffect(() => {
        const refresh = () => setSession(manager.getCurrentSession());
        const offStore = store.onChanged(refresh);
        const offManager = manager.onChanged(refresh);
        return () => {
            offStore();
            offManager();
        };
    }, [store, manager]);

    return session;
}

/** The current session's archived tasks, filtered by `query`. Archives are per session, not global. */
export function useArchive(query: string): { entries: ArchivedEntry[]; total: number } {
    const session = useCurrentSession();

    const all = useMemo(() => buildArchivedEntries(session), [session]);
    const entries = useMemo(() => all.filter((e) => archivedEntryMatches(e, query)), [all, query]);
    return { entries, total: all.length };
}

/** Archived-task count of the current session, for the toolbar badge. */
export function useArchivedCount(): number {
    return countArchived(useCurrentSession());
}
