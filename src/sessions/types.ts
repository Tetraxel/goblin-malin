import { TaskSnapshot } from "#base/task/task";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

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
    tasks: SessionTaskSnapshot[];
    /** Archived tasks: never loaded into the queue, so they don't run or clutter the task list. */
    archived?: ArchivedTaskSnapshot[];
    /** True once the user has explicitly renamed the session (vs. the derived default name). */
    renamed?: boolean;
}

export interface SessionsFile {
    version: 1;
    lastSessionId: string | null;
    sessions: StoredSession[];
}
