import { randomBytes } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { getAppDataDir } from "#utils/appPaths";
import { ensurePrivateDir } from "#utils/privateDir";

/** Where an mpv instance is told to put its control socket, and where this app connects to it. */
export interface IpcEndpoint {
    /** What `--input-ipc-server=` is given (a bare pipe name on Windows: mpv adds `\\.\pipe\`). */
    arg: string;
    /** What a `net.Socket` connects to. */
    path: string;
}

/**
 * The longest socket path a Unix system accepts is 104 bytes on macOS and 108 on Linux (including the end marker): a
 * longer one cannot be bound. A little below the smaller one, for safety.
 */
const MAX_SOCKET_PATH_BYTES = 100;

/**
 * mpv's JSON IPC can run any command mpv can (load a file, run a script), so its control socket is as sensitive as a
 * shell. On Linux and macOS it goes in a folder of the app's own that only the user can enter (a predictable name in
 * the shared temp folder could be taken, or pointed somewhere, by another user); when that path is too long for a
 * socket (a deep home folder or `GOBLIN_DATA_DIR`), in a fresh private folder (mode 0700, random name) of the temp
 * folder instead. On Windows the pipe name carries a random part, since a pipe has no folder.
 */
export async function createIpcEndpoint(name: string): Promise<IpcEndpoint> {
    if (process.platform === "win32") {
        const pipe = `${name}-${randomBytes(6).toString("hex")}`;
        return { arg: pipe, path: `\\\\.\\pipe\\${pipe}` };
    }
    let dir = await ensurePrivateDir(path.join(getAppDataDir(), "run"));
    if (Buffer.byteLength(path.join(dir, `${name}.sock`)) > MAX_SOCKET_PATH_BYTES) {
        // `mkdtemp` makes the folder with mode 0700 and a name nobody can guess.
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "goblin-"));
    }
    const socket = path.join(dir, `${name}.sock`);
    // A leftover of a process that died (the pid came round again): mpv cannot bind over it.
    await fs.rm(socket, { force: true });
    return { arg: socket, path: socket };
}
