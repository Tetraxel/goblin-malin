import { useSyncExternalStore } from "react";
import { SessionStore } from "#sessions/sessionStore";
import { SessionManager } from "#sessions/sessionManager";
import { subscribeToSessions } from "#sessions/subscribeToSessions";

/** The current session's name when the user explicitly renamed it; derived default names give null. */
function currentSessionName(): string | null {
    const id = SessionManager.getInstance().getCurrentSessionId();
    if (!id) return null;
    const session = SessionStore.getInstance().getById(id);
    return session?.renamed ? session.name : null;
}

/**
 * Name of the current session, but only when the user explicitly renamed it
 * (derived default names return null). A string, so a save of the open session (every few seconds during a run)
 * re-renders the toolbar only when the name really changed.
 */
export function useCurrentSessionName(): string | null {
    return useSyncExternalStore(subscribeToSessions, currentSessionName);
}
