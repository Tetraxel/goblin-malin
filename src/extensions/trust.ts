import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { globalLogger } from "#base/logger/logger";
import { getTrustFilePath } from "./manifest";

/**
 * The user's answer for each extension (P34), with the hash of its files at the time: `extensions.json` in the data
 * folder. An extension is loaded only when the answer is "load" AND its files still hash the same; any change of a
 * file asks again.
 */
export type TrustAnswer = "load" | "off";
export type TrustEntry = { answer: TrustAnswer; hash: string; at: string };
export type TrustRecord = Record<string, TrustEntry>;

/** Folders never hashed: their content follows from the lock files, which are. */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);
/** A file bigger than this is hashed by its size and date only (a model, a big asset): reading it at every start would be slow. */
const FULL_HASH_MAX_BYTES = 8 * 1024 * 1024;

/**
 * A hash of every file of the folder (their relative paths and contents), except `node_modules/` and `.git/`.
 * Asynchronous: no synchronous file system call at start-up.
 */
export async function hashFolder(folder: string): Promise<string> {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRS.has(entry.name)) await walk(full);
            } else if (entry.isFile()) {
                files.push(full);
            }
        }
    };
    await walk(folder);
    files.sort();
    const hash = createHash("sha256");
    for (const file of files) {
        const relative = path.relative(folder, file).split(path.sep).join("/");
        hash.update(`${relative}\u0000`);
        const stat = await fs.stat(file);
        if (stat.size > FULL_HASH_MAX_BYTES) hash.update(`size:${stat.size};mtime:${stat.mtimeMs}`);
        else hash.update(await fs.readFile(file));
        hash.update("\u0000");
    }
    return `sha256:${hash.digest("hex")}`;
}

export async function readTrustRecord(file = getTrustFilePath()): Promise<TrustRecord> {
    try {
        const raw = JSON.parse(await fs.readFile(file, "utf-8")) as unknown;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
        const record: TrustRecord = {};
        for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
            const e = entry as Partial<TrustEntry>;
            if ((e?.answer === "load" || e?.answer === "off") && typeof e.hash === "string") {
                record[name] = { answer: e.answer, hash: e.hash, at: typeof e.at === "string" ? e.at : "" };
            }
        }
        return record;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            globalLogger.warn("Could not read the extensions' trust record: every extension is asked about again", {
                error,
            });
        }
        return {};
    }
}

// Writes go one after the other: two answers given quickly must both be kept.
let writing: Promise<void> = Promise.resolve();

/** Records an answer (or forgets one with `undefined`). Written through a temporary file, in the background. */
export function writeTrustEntry(name: string, entry: TrustEntry | undefined, file = getTrustFilePath()): Promise<void> {
    const next = writing.then(async () => {
        const record = await readTrustRecord(file);
        if (entry) record[name] = entry;
        else delete record[name];
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
        await fs.rename(tmp, file);
    });
    writing = next.catch((error) => {
        globalLogger.error("Could not save the extensions' trust record", { error });
    });
    return next;
}
