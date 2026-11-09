import { type TaskSnapshot } from "#base/task/task";
import { type MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export type SessionTaskSnapshot = TaskSnapshot<MusicDownloadTaskAttributes>;

/** A task taken out of the live queue but kept (metadata, sources, saved file) inside its session. */
export interface ArchivedTaskSnapshot {
    archivedAt: string;
    task: SessionTaskSnapshot;
}

export interface StoredSession {
    id: string;
    name: string;
    /** Legacy field from the flow era — ignored on read, no longer written. */
    flowId?: string;
    createdAt: string;
    updatedAt: string;
    /**
     * When the session was last in use: bumped when it is opened and when the app closes with it open, without
     * touching `updatedAt` (which is about edits, and drives the list order). Temporary downloads of a session
     * used recently are kept even if the session itself is old. Absent in files saved before this field existed.
     */
    lastUsedAt?: string;
    tasks: SessionTaskSnapshot[];
    /** Archived tasks: never loaded into the queue, so they don't run or clutter the task list. */
    archived?: ArchivedTaskSnapshot[];
    /** True once the user has explicitly renamed the session (vs. the derived default name). */
    renamed?: boolean;
}

export interface SessionsFile {
    /** File-format version; see `SESSIONS_FILE_VERSION` in `sessionStore.ts`. */
    version: number;
    lastSessionId: string | null;
    sessions: StoredSession[];
}
