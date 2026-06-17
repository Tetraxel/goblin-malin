import { TaskSnapshot } from "#base/task/task";
import { MusicDownloadTaskAttributes } from "#flows/musicDownloadFlow/types";

export type SessionTaskSnapshot = TaskSnapshot<MusicDownloadTaskAttributes>;

export interface StoredSession {
    id: string;
    name: string;
    flowId: string;
    createdAt: string;
    updatedAt: string;
    tasks: SessionTaskSnapshot[];
}

export interface SessionsFile {
    version: 1;
    lastSessionId: string | null;
    sessions: StoredSession[];
}
