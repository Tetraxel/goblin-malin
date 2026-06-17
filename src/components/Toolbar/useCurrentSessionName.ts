import { useState, useEffect } from "react";
import { SessionStore } from "#sessions/sessionStore";
import { SessionManager } from "#sessions/sessionManager";

/**
 * Name of the current session, but only when the user explicitly renamed it
 * (derived default names return null). Re-renders on session switch / rename.
 */
export function useCurrentSessionName(): string | null {
    const store = SessionStore.getInstance();
    const manager = SessionManager.getInstance();

    const compute = (): string | null => {
        const id = manager.getCurrentSessionId();
        if (!id) return null;
        const session = store.getById(id);
        return session?.renamed ? session.name : null;
    };

    const [name, setName] = useState<string | null>(compute);

    useEffect(() => {
        const unsubStore = store.onChanged(() => setName(compute()));
        const unsubManager = manager.onChanged(() => setName(compute()));
        return () => {
            unsubStore();
            unsubManager();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [store, manager]);

    return name;
}
