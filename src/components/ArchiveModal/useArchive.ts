import { useMemo, useSyncExternalStore } from "react";
import { SessionManager } from "#sessions/sessionManager";
import { subscribeToSessions } from "#sessions/subscribeToSessions";
import { type ArchivedEntry, archivedEntryMatches, buildArchivedEntries, countArchived } from "#sessions/archive";

const noUnsubscribe = (): void => {};
/** Stable identity: a new `subscribe` function each render would make React unsubscribe and resubscribe. */
const subscribeToNothing = (): (() => void) => noUnsubscribe;

/**
 * The current session's archived tasks, filtered by `query`. Archives are per session, not global.
 * `enabled` is whether the archive is on screen: a closed modal does not follow the store (it changes on every save
 * of the open session) and builds nothing.
 */
export function useArchive(query: string, enabled: boolean = true): { entries: ArchivedEntry[]; total: number } {
    const manager = SessionManager.getInstance();
    // The stored record of the open session: it follows the store (archive/restore/persist) and the manager
    // (new/load), so the archive always follows the session. Same object until a save replaces it.
    const session = useSyncExternalStore(enabled ? subscribeToSessions : subscribeToNothing, () =>
        enabled ? manager.getCurrentSession() : undefined
    );

    const all = useMemo(() => buildArchivedEntries(session), [session]);
    const entries = useMemo(() => all.filter((e) => archivedEntryMatches(e, query)), [all, query]);
    return { entries, total: all.length };
}

/** Archived-task count of the current session, for the toolbar badge. Re-renders only when the count changes. */
export function useArchivedCount(): number {
    return useSyncExternalStore(subscribeToSessions, () =>
        countArchived(SessionManager.getInstance().getCurrentSession())
    );
}
