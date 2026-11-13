import { SessionStore } from "./sessionStore";
import { SessionManager } from "./sessionManager";

/**
 * Calls `listener` when a stored session changed (every save) or the open session switched. For
 * `useSyncExternalStore`: the snapshot function decides whether anything the component shows really changed, so a
 * save that touches nothing it shows costs it no render.
 */
export function subscribeToSessions(listener: () => void): () => void {
    const offStore = SessionStore.getInstance().onChanged(listener);
    const offManager = SessionManager.getInstance().onChanged(listener);
    return () => {
        offStore();
        offManager();
    };
}
