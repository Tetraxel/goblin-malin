import { useState, useEffect } from "react";
import { SessionStore } from "#sessions/sessionStore";
import { SessionManager } from "#sessions/sessionManager";
import { StoredSession } from "#sessions/types";
import { sessionMatchesQuery } from "#sessions/sessionSearch";

export function useSessions(query: string): {
    sessions: StoredSession[];
    currentSessionId: string | null;
} {
    const store = SessionStore.getInstance();
    const manager = SessionManager.getInstance();

    const [sessions, setSessions] = useState<StoredSession[]>(() => store.getAll());
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => manager.getCurrentSessionId());

    useEffect(() => {
        const unsubStore = store.onChanged(() => setSessions(store.getAll()));
        const unsubManager = manager.onChanged(() => setCurrentSessionId(manager.getCurrentSessionId()));
        return () => {
            unsubStore();
            unsubManager();
        };
    }, [store, manager]);

    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const others = sessions.filter((s) => s.id !== currentSessionId);

    const sorted = [
        ...(currentSession ? [currentSession] : []),
        ...others.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ];

    const filtered = sorted.filter((s) => sessionMatchesQuery(s, query));

    return { sessions: filtered, currentSessionId };
}
