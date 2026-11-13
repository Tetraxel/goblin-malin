import { type SessionsFile, type StoredSession } from "./types";

/**
 * Turns the sessions file into text without stringifying again what has not changed.
 *
 * A save used to run `JSON.stringify` over every session, every task and every archived entry, on the main thread:
 * 60+ ms for a 14 MB file, every time anything changed (several times a minute during a run), even though a save
 * only changes the open session's few busy tasks. Here the text of each task snapshot and of each session is
 * remembered, keyed by the object itself. The store never mutates what it holds (it builds new objects, and
 * `Task.get()` returns a new snapshot whenever the task changed), so an object seen again is unchanged and its
 * text can be reused as it is. A save then stringifies the objects that are new, and joins strings for the rest.
 *
 * The output parses to exactly what `JSON.stringify(file)` would give (only the key order inside a session moves:
 * its `tasks` and `archived` come last).
 */

/** Text of one task snapshot or archived entry (non-object elements are not cached). */
const pieceCache = new WeakMap<object, string>();
/** Text of one whole session. */
const sessionCache = new WeakMap<StoredSession, string>();

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

function pieceText(piece: unknown): string {
    if (!isObject(piece)) return JSON.stringify(piece) ?? "null";
    let text = pieceCache.get(piece);
    if (text === undefined) {
        text = JSON.stringify(piece);
        pieceCache.set(piece, text);
    }
    return text;
}

/** `{...head}` + extra members → one object text. `head` is already a stringified object. */
function withMembers(head: string, members: string[]): string {
    if (members.length === 0) return head;
    return head.slice(0, -1) + (head.length > 2 ? "," : "") + members.join(",") + "}";
}

function archivedEntryText(entry: unknown): string {
    if (!isObject(entry)) return pieceText(entry);
    let text = pieceCache.get(entry);
    if (text === undefined) {
        const { task, ...rest } = entry as { task?: unknown };
        text = withMembers(JSON.stringify(rest), task === undefined ? [] : [`"task":${pieceText(task)}`]);
        pieceCache.set(entry, text);
    }
    return text;
}

function sessionText(session: StoredSession): string {
    const cached = sessionCache.get(session);
    if (cached !== undefined) return cached;

    const { tasks, archived, ...rest } = session;
    const members = [`"tasks":[${tasks.map(pieceText).join(",")}]`];
    if (Array.isArray(archived)) members.push(`"archived":[${archived.map(archivedEntryText).join(",")}]`);
    const text = withMembers(JSON.stringify(rest), members);
    sessionCache.set(session, text);
    return text;
}

/** The text to write for `file`. Equivalent to `JSON.stringify(file)`, but cheap when most sessions are unchanged. */
export function serializeSessionsFile(file: SessionsFile): string {
    const { sessions, ...rest } = file;
    return withMembers(JSON.stringify(rest), [`"sessions":[${sessions.map(sessionText).join(",")}]`]);
}
