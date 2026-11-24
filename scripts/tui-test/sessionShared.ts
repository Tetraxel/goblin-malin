import os from "node:os";
import path from "node:path";

/** Where a running interactive session leaves the address and token of its server. */
export const SESSIONS_DIR = path.join(os.tmpdir(), "goblin-tui-test", "sessions");

export interface SessionRecord {
    name: string;
    pid: number;
    port: number;
    token: string;
    startedAt: number;
}
