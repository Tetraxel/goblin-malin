import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Large-session generator for the performance scenarios.
 *
 * The checked-in fixtures stop at 50 tasks, but most of the audited costs only show at hundreds or thousands
 * (`AUDIT-performance.md`: PERF-01, PERF-02, PERF-05). Committing a 5 MB `sessions.json` would bloat the repo,
 * so a scenario asks for a size instead (`"scale": { "tasks": 2000 }`) and the runner grows the throwaway copy
 * of its fixture before the app starts. The tracked fixtures are never touched.
 *
 * The tasks are the first session's tasks of the fixture, repeated with fresh ids. They keep their metadata,
 * so rows render like real ones.
 */
export interface ScaleOptions {
    /** Tasks in the open (last) session. Default: keep the fixture's. */
    tasks?: number;
    /** Extra sessions the user is not looking at (they are still parsed and written on every save). Default 0. */
    otherSessions?: number;
    /** Tasks in each extra session. Default 100. */
    otherSessionTasks?: number;
    /** Archived entries added to the open session. Default 0. */
    archived?: number;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

let counter = 0;
/** A short unique token: keeps the clones' ids (and Spotify ids) distinct without being random between runs. */
const token = (): string => (counter++).toString(36).padStart(6, "0");

/** Replaces every occurrence of the template's identifiers with a fresh one, so clones don't dedupe. */
function cloneTask(template: Json, index: number): Json {
    const suffix = `${index.toString(36)}${token()}`;
    const oldId = String(template.id);
    const newId = `task:${suffix}`;
    // Ids appear in the task id, in its URL and in its `uri`: rewrite all of them in one pass over the JSON text.
    let text = JSON.stringify(template).split(oldId).join(newId);
    const spotifyId = /"id":\s*"([0-9A-Za-z]{22})"/.exec(text)?.[1];
    if (spotifyId) text = text.split(spotifyId).join((suffix + spotifyId).slice(0, 22));
    return JSON.parse(text) as Json;
}

function makeTasks(templates: Json[], count: number): Json[] {
    const out: Json[] = [];
    for (let i = 0; i < count; i++) out.push(cloneTask(templates[i % templates.length]!, i));
    return out;
}

/** Rewrites `<dir>/sessions.json` in place to the requested size. No-op when no option is set. */
export function scaleSessionsFile(dir: string, options: ScaleOptions): void {
    const wanted = options.tasks !== undefined || options.otherSessions !== undefined || options.archived !== undefined;
    if (!wanted) return;

    const file = path.join(dir, "sessions.json");
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
    if (!isObject(parsed) || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
        throw new Error(
            `scale: ${file} has no session to take tasks from (use a fixture such as 50-tasks-with-metadata)`
        );
    }
    const base = parsed.sessions[0] as Json;
    const templates = (base.tasks as Json[]).filter(isObject);
    if (templates.length === 0) throw new Error(`scale: the first session of ${file} has no task`);

    const now = new Date().toISOString();
    const open: Json = { ...base, tasks: makeTasks(templates, options.tasks ?? templates.length) };
    if (options.archived) {
        open.archived = makeTasks(templates, options.archived).map((task) => ({ archivedAt: now, task }));
    }

    const others: Json[] = [];
    for (let s = 0; s < (options.otherSessions ?? 0); s++) {
        others.push({
            ...base,
            id: randomUUID(),
            name: `Other session ${s + 1}`,
            // Older than the open one, so the open one stays "the last session".
            updatedAt: new Date(Date.now() - (s + 1) * 3_600_000).toISOString(),
            tasks: makeTasks(templates, options.otherSessionTasks ?? 100),
        });
    }

    const result = { ...parsed, lastSessionId: open.id, sessions: [open, ...others] };
    fs.writeFileSync(file, JSON.stringify(result), "utf-8");
}
