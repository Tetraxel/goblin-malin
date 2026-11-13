import { useCallback, useMemo, useSyncExternalStore } from "react";
import { SessionStore } from "#sessions/sessionStore";
import { SessionManager } from "#sessions/sessionManager";
import { type StoredSession } from "#sessions/types";
import { sessionMatchesQuery } from "#sessions/sessionSearch";

const NO_SESSIONS: StoredSession[] = [];
const noUnsubscribe = (): void => {};

/**
 * The sessions to list, current one first. `enabled` is whether the list is on screen: a closed modal neither
 * follows the store (it changes on every save of the open session) nor sorts and filters anything.
 */
export function useSessions(
    query: string,
    enabled: boolean = true
): {
    sessions: StoredSession[];
    currentSessionId: string | null;
} {
    const store = SessionStore.getInstance();
    const manager = SessionManager.getInstance();

    const subscribeStore = useCallback(
        (listener: () => void) => (enabled ? store.onChanged(listener) : noUnsubscribe),
        [store, enabled]
    );
    const subscribeManager = useCallback(
        (listener: () => void) => (enabled ? manager.onChanged(listener) : noUnsubscribe),
        [manager, enabled]
    );
    // `getAll()` returns the same array until a save replaces it, so a render without a change is skipped.
    const stored = useSyncExternalStore(subscribeStore, () => (enabled ? store.getAll() : NO_SESSIONS));
    const currentSessionId = useSyncExternalStore(subscribeManager, () =>
        enabled ? manager.getCurrentSessionId() : null
    );

    const sessions = useMemo(() => {
        if (!enabled) return NO_SESSIONS;
        const currentSession = stored.find((s) => s.id === currentSessionId);
        const others = stored.filter((s) => s.id !== currentSessionId);
        const sorted = [
            ...(currentSession ? [currentSession] : []),
            ...others.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        ];
        return sorted.filter((s) => sessionMatchesQuery(s, query));
    }, [enabled, stored, currentSessionId, query]);

    return { sessions, currentSessionId };
}
