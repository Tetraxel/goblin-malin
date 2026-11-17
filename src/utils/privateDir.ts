import * as fs from "fs/promises";

/**
 * Creates `dir` (and its parents) readable by the user only (mode 0700), without blocking the event loop. The chmod is
 * for a folder that already existed with looser rights; it is skipped where the file system has no modes (Windows:
 * the profile's own permissions apply there).
 */
export async function ensurePrivateDir(dir: string): Promise<string> {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    try {
        await fs.chmod(dir, 0o700);
    } catch {
        // Not ours to change, or no modes here: the folder is still in a place the user chose.
    }
    return dir;
}
