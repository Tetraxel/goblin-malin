import { AgentToolError, defineAgentTool } from "#base/agent/agentTool";
import { type JsonSchema } from "#base/agent/jsonSchema";
import { SessionManager } from "#sessions/sessionManager";
import { getArchivedTaskIds } from "#sessions/archive";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { taskLocks } from "#base/task/taskLock";
import { urlParserRegistry } from "#base/urlParser";
import { createTasksFromUrls, importTasks } from "../../taskFactory";
import { taskIdFromUrl } from "../../utils/taskId";
import { discoveryServiceRegistry } from "../../registries";
import { type CollectionDownloadTask, type MetadataOverrides, type TrackDownloadTask } from "../../types";
import { OVERRIDE_FIELDS } from "../../utils/overrideValidation";
import { computeCompiledMetadata } from "../../utils/compiledMetadata";
import { DownloadTask } from "../../utils/downloadTask";
import { downloadSourceIds } from "../../utils/taskRevision";
import {
    agentJournal,
    agentWrite,
    allTasks,
    assertAgentMayWrite,
    findTask,
    isTaskRunning,
    requireDownloadTask,
} from "../taskAccess";
import { sourceView } from "../views";
import { joinSameCall } from "../joinSameCall";

const taskIdSchema: JsonSchema = { type: "string", minLength: 1, maxLength: 200 };
const revisionSchema: JsonSchema = {
    type: "integer",
    minimum: 0,
    description: "The `revision` you read from get_task / get_sources (or the one the last write returned).",
};

/** The fields set_metadata_override can set. Plain values: the same ones, with the same checks, as typing in the panel. */
export const overridePatchSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        trackName: { type: "string", minLength: 1, maxLength: 300, description: "The title." },
        artists: { type: "array", items: { type: "string", minLength: 1, maxLength: 200 }, minItems: 1, maxItems: 30 },
        duration: { type: "integer", minimum: 1000, description: "In milliseconds." },
        isrc: { type: "string", maxLength: 20, description: "12 characters, like FRT092400049." },
        year: { type: "integer", minimum: 1000, maximum: 2200 },
        trackNumber: { type: "integer", minimum: 1, maximum: 999 },
        bpm: { type: "integer", minimum: 1, maximum: 400 },
        key: { type: "string", maxLength: 20 },
        genres: { type: "array", items: { type: "string", minLength: 1, maxLength: 60 }, minItems: 1, maxItems: 30 },
    },
};

type SetOverrideInput = { taskId: string; revision: number; patch?: Record<string, unknown>; clear?: string[] };

/** Turns the tool's `patch` + `clear` into one object for `patchMetadataOverride` (null clears a field). */
export function toOverridePatch(patch: Record<string, unknown> | undefined, clear: string[] | undefined) {
    const out: Record<string, unknown> = { ...(patch ?? {}) };
    for (const field of clear ?? []) {
        if (field in out) throw new AgentToolError(`"${field}" is both set and cleared.`, "invalid");
        out[field] = null;
    }
    if (Object.keys(out).length === 0) throw new AgentToolError("Give something in patch or clear.", "invalid");
    return out;
}

/** What a track is called in a dialog or a log line: its title as the list shows it, else the link it came from. */
export const labelOf = (task: ReturnType<typeof requireDownloadTask>): string => {
    const a = task.getAttributes() as TrackDownloadTask;
    const compiled = computeCompiledMetadata(a.metadataGroups ?? [], a.metadataOverride ?? {});
    const artist = compiled.artists[0]?.name;
    if (compiled.trackName) return artist ? `${compiled.trackName} – ${artist}` : compiled.trackName;
    return a.userInput?.url ? shortLink(a.userInput.url) : task.getId();
};

/** A link shortened to fit a dialog: no scheme, no "www.", cut with an ellipsis. */
export function shortLink(url: string, max = 44): string {
    const bare = url.replace(/^https?:\/\/(www\.)?/i, "");
    return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}

export const setMetadataOverride = defineAgentTool<SetOverrideInput>({
    name: "set_metadata_override",
    summary:
        "Changes the metadata of a track that will be written to its file's tags (title, artists, year…), as if the user had typed it in the Metadata panel. `patch` sets fields, `clear` takes an override back so the platforms' value shows again. Carries the revision you read.",
    kind: "write",
    locks: "task",
    undoable: true,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "revision"],
        properties: {
            taskId: taskIdSchema,
            revision: revisionSchema,
            patch: overridePatchSchema,
            clear: { type: "array", items: { type: "string", enum: [...OVERRIDE_FIELDS] }, maxItems: 10 },
        },
    },
    example: { taskId: "task-1a2b3c", revision: 1234567, patch: { trackName: "Song Title" }, clear: ["year"] },
    describeCall: (input) => `set_metadata_override → ${input.taskId}`,
    run: async (input, ctx) => {
        const task = requireDownloadTask(input.taskId);
        const patch = toOverridePatch(input.patch, input.clear);
        // Artist names arrive as plain strings; the panel stores artist objects. `validate` accepts both.
        return agentWrite({
            ctx,
            tool: "set_metadata_override",
            task,
            revision: input.revision,
            label: `set_metadata_override → ${labelOf(task)}`,
            change: (as) => {
                const before = { ...(task.getAttributes()?.metadataOverride ?? {}) } as MetadataOverrides;
                const overrides = task.patchMetadataOverride(patch, as);
                return {
                    result: { overrides },
                    restore: () => task.restoreMetadataOverride(before, { actor: "user" }),
                };
            },
        });
    },
});

type SourceInput = { taskId: string; revision: number; sourceId: string };

function findRow(task: ReturnType<typeof requireDownloadTask>, sourceId: string) {
    const attrs = task.getAttributes() as TrackDownloadTask;
    const ids = downloadSourceIds(attrs.downloadSources);
    const index = ids.indexOf(sourceId);
    if (index === -1) {
        throw new AgentToolError(
            `No download row "${sourceId}" on this task. Use get_sources for the current ids (they change when the downloads are redone).`,
            "not-found"
        );
    }
    return { index, row: attrs.downloadSources[index], ids };
}

function flagsOf(task: ReturnType<typeof requireDownloadTask>) {
    const sources = (task.getAttributes() as TrackDownloadTask).downloadSources;
    const ids = downloadSourceIds(sources);
    return sources.map((s, i) => ({ id: ids[i], selected: s.selected, isRejected: !!s.isRejected }));
}

export const selectSource = defineAgentTool<SourceInput>({
    name: "select_source",
    summary:
        "Chooses which download row a track will be saved from. The row must be downloaded and not rejected. Addressed by the row's `id` from get_sources. It does not save anything.",
    kind: "write",
    locks: "task",
    undoable: true,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "sourceId", "revision"],
        properties: {
            taskId: taskIdSchema,
            sourceId: { type: "string", minLength: 1, maxLength: 600 },
            revision: revisionSchema,
        },
    },
    example: { taskId: "task-1a2b3c", sourceId: "ytdlp||https://youtu.be/abc", revision: 1234567 },
    describeCall: (input) => `select_source → ${input.taskId}`,
    run: async (input, ctx) => {
        const task = requireDownloadTask(input.taskId);
        const { row } = findRow(task, input.sourceId);
        if (row.isRejected)
            throw new AgentToolError("That row is rejected. Reject it with rejected=false first.", "invalid");
        if (row.state !== "downloaded") {
            throw new AgentToolError(`That row is "${row.state}", not downloaded: it cannot be saved from.`, "invalid");
        }
        return agentWrite({
            ctx,
            tool: "select_source",
            task,
            revision: input.revision,
            label: `select_source → ${labelOf(task)}`,
            change: (as) => {
                const before = flagsOf(task);
                const selected = task.selectDownloadSourceById(input.sourceId, as);
                return {
                    result: { selected: sourceView(selected, input.sourceId) },
                    restore: () => task.restoreDownloadFlags(before, { actor: "user" }),
                };
            },
        });
    },
});

export const rejectSource = defineAgentTool<SourceInput & { rejected?: boolean }>({
    name: "reject_source",
    summary:
        "Rejects a download row (the user does not want it; it is never selected, and a download in progress is stopped), or with rejected=false brings it back. Addressed by the row's `id` from get_sources.",
    kind: "write",
    locks: "task",
    undoable: true,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "sourceId", "revision"],
        properties: {
            taskId: taskIdSchema,
            sourceId: { type: "string", minLength: 1, maxLength: 600 },
            rejected: { type: "boolean", description: "Default true." },
            revision: revisionSchema,
        },
    },
    example: { taskId: "task-1a2b3c", sourceId: "soulseek|someuser|Song.mp3", revision: 1234567 },
    describeCall: (input) => `reject_source → ${input.taskId}`,
    run: async (input, ctx) => {
        const task = requireDownloadTask(input.taskId);
        const { row: current } = findRow(task, input.sourceId);
        const rejected = input.rejected !== false;
        // Rejecting a row that is being searched or downloaded stops it. Putting the flags back would not start it
        // again (and a download is the user's to start), so that case is not offered to /undo: better no undo than
        // one that says "undone" over a download that stays stopped.
        const stopsDownload = rejected && (current.state === "searching" || current.state === "downloading");
        return agentWrite({
            ctx,
            tool: "reject_source",
            task,
            revision: input.revision,
            label: `reject_source → ${labelOf(task)}`,
            change: (as) => {
                const before = flagsOf(task);
                const row = task.rejectDownloadSourceById(input.sourceId, rejected, as);
                return {
                    result: {
                        source: sourceView(row, input.sourceId),
                        ...(stopsDownload
                            ? {
                                  note: "A download in progress was stopped by this. It cannot be undone with /undo: run_download starts the downloads again (the user is asked first).",
                              }
                            : {}),
                    },
                    restore: stopsDownload ? undefined : () => task.restoreDownloadFlags(before, { actor: "user" }),
                };
            },
        });
    },
});

export const addUserSource = defineAgentTool<{ taskId: string; revision: number; url: string }>({
    name: "add_user_source",
    summary:
        "Adds a track link the user gave you to a track, as a source (like pasting it onto the track): it is read through the metadata service that owns it and kept even when the task is restarted. Only use a link the user wrote or that lookup_url confirmed, never one you guessed.",
    kind: "write",
    locks: "task",
    undoable: true,
    leaseMs: 120_000,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "url", "revision"],
        properties: {
            taskId: taskIdSchema,
            url: { type: "string", minLength: 8, maxLength: 500 },
            revision: revisionSchema,
        },
    },
    example: { taskId: "task-1a2b3c", url: "https://open.spotify.com/track/4rye8ZgoRgbQPfgBqxjfqG", revision: 1234567 },
    describeCall: (input) => `add_user_source → ${input.taskId}`,
    run: async (input, ctx) => {
        const task = requireDownloadTask(input.taskId);
        const had = new Set((task.getAttributes()?.userSources ?? []).map((s) => s.uri));
        return agentWrite({
            ctx,
            tool: "add_user_source",
            task,
            revision: input.revision,
            label: `add_user_source → ${labelOf(task)}`,
            change: async (as) => {
                const { added, skipped } = await task.addUserSources([input.url], as);
                const fresh = added.filter((s) => !had.has(s.uri));
                return {
                    result: {
                        added: added.map((s) => ({ url: s.url, uri: s.uri, new: !had.has(s.uri) })),
                        skipped,
                    },
                    // Undo takes back only what this call added; a link the user already had stays theirs.
                    restore:
                        fresh.length > 0
                            ? () => {
                                  for (const s of fresh) task.removeUserSource(s.uri, { actor: "user" });
                              }
                            : undefined,
                };
            },
        });
    },
});

/** How long a renewed lease of a long call lasts past each renewal (see `rediscover`). */
const LEASE_RENEW_MS = 60_000;

/** Discovery providers the agent may ask again: not the slow, costly last resorts (the user starts those). */
function rediscoverableProviders(): string[] {
    return [...discoveryServiceRegistry.getAllConstructors()]
        .filter(([, ctor]) => !ctor.lastResort)
        .map(([key]) => key);
}

export const rediscover = defineAgentTool<{ taskId: string; revision: number; provider?: string }>({
    name: "rediscover",
    summary:
        "Looks for the track on the other platforms again: with a `provider`, only that discovery service; without, the whole discovery stage (what the search found is replaced; the user's own links and overrides are kept), except the slow, costly last-resort services, which only the user starts. Slow. Not undoable.",
    kind: "write",
    locks: "task",
    undoable: false,
    leaseMs: 300_000,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "revision"],
        properties: {
            taskId: taskIdSchema,
            revision: revisionSchema,
            provider: {
                type: "string",
                maxLength: 40,
                description: "A discovery provider key (musicBrainz, songlink…).",
            },
        },
    },
    example: { taskId: "task-1a2b3c", revision: 1234567, provider: "musicBrainz" },
    describeCall: (input) => `rediscover → ${input.taskId}${input.provider ? ` (${input.provider})` : ""}`,
    run: async (input, ctx) => {
        const task = requireDownloadTask(input.taskId);
        const allowed = rediscoverableProviders();
        if (input.provider && !allowed.includes(input.provider)) {
            throw new AgentToolError(
                `"${input.provider}" cannot be asked again here. Providers: ${allowed.join(", ")}.`,
                "invalid"
            );
        }
        if (!task.getAttributes()?.primaryMetadataFetched) {
            throw new AgentToolError(
                "This track has no primary metadata yet: there is nothing to look up from.",
                "invalid"
            );
        }
        assertAgentMayWrite(task, input.revision);
        const overBudget = ctx.turn.spend([task.getId()]);
        if (overBudget) throw new AgentToolError(overBudget, "budget");

        // Through the task, not the discovery calls themselves: it counts as a run, so nothing else writes to or
        // starts the track while the groups are being rebuilt.
        // Stop (the signal) ends a whole-stage search early, keeping what it found so far (the user's "skip
        // discovery"), and a run still waiting for its turn never starts. A search of one provider is a single
        // request and finishes by itself. The whole stage leaves out the last-resort services (Claude).
        // The run may wait a long time for the metadata stage's turn before it even starts, and a lease that runs out
        // counts as free: the user could then edit the track while the groups are rebuilt under them. So the lease is
        // renewed for as long as the run lasts (a second lease of the same turn on the task, which shares its entry).
        const keepHeld = ctx.turn.acquire([task.getId()], LEASE_RENEW_MS);
        const renewer =
            "lease" in keepHeld
                ? setInterval(() => keepHeld.lease.renew(LEASE_RENEW_MS), LEASE_RENEW_MS / 3)
                : undefined;
        renewer?.unref?.();
        try {
            await task.rediscoverPart(input.provider, { actor: "agent", signal: ctx.signal });
        } finally {
            if (renewer) clearInterval(renewer);
            if ("lease" in keepHeld) keepHeld.lease.release();
        }
        const attrs = task.getAttributes() as TrackDownloadTask;
        return {
            revision: task.getRevision(),
            platforms: attrs.metadataGroups.filter((g) => g.results.length > 0).map((g) => g.serviceKey),
        };
    },
});

type ArchivableTask = NonNullable<ReturnType<typeof findTask>>;

/**
 * Whether the task (a track, album or playlist) is being processed: it is left out of an archive. A track counts when
 * the pipeline or a part run works on it, or someone else holds it; an album or playlist when it runs itself or any of
 * its tracks is busy (the archive takes the tracks with it).
 */
const isTrackBusy = (track: DownloadTask): boolean => isTaskRunning(track) || taskLocks.isLocked(track.getId());

const isArchiveBusy = (task: ArchivableTask): boolean => {
    if (task instanceof DownloadTask) return isTrackBusy(task);
    if (task.running) return true;
    const children = (task.getAttributes() as CollectionDownloadTask | undefined)?.childTaskIds ?? [];
    return children.some((id) => {
        const child = findTask(id);
        return child instanceof DownloadTask && isTrackBusy(child);
    });
};

/** What an archive dialog calls a task: a track by its title, an album, playlist or group by its name. */
function archiveLabel(task: ArchivableTask): string {
    if (task instanceof DownloadTask) return labelOf(task);
    const a = task.getAttributes() as CollectionDownloadTask | undefined;
    const kind = a?.collectionKind ?? "collection";
    if (a?.name) return `${a.name} (${kind})`;
    // A group has no link: its name is all it has.
    return a?.userInput?.url ? `${shortLink(a.userInput.url)} (${kind})` : `${kind} ${task.getId()}`;
}

export const archiveTasks = defineAgentTool<{ taskIds: string[] }>({
    name: "archive_tasks",
    summary:
        "Moves tasks (tracks, albums, playlists or groups the user made; the tracks of an album, playlist or group go with it) to the archive (their metadata and sources are kept; the user can restore them from the Archive window). Always asks the user first. Tasks that are being processed are left out, and an id that is no task is reported in `skipped`.",
    kind: "confirm",
    locks: "tasks",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskIds"],
        properties: { taskIds: { type: "array", items: taskIdSchema, minItems: 1, maxItems: 100 } },
    },
    example: { taskIds: ["task-1a2b3c", "task-4d5e6f"] },
    describeCall: (input) => `archive_tasks (${input.taskIds.length})`,
    run: ({ taskIds }, ctx) =>
        joinSameCall("archive_tasks", ctx, taskIds, async () => {
            // Tracks, albums and playlists alike (the archive takes an album's tracks with it). An id that is no task is
            // reported and left out, like the run tools do: one bad id must not refuse the rest.
            const tasks: ArchivableTask[] = [];
            const unknown: { taskId: string; reason: string }[] = [];
            const seen = new Set<string>();
            for (const id of new Set(taskIds)) {
                const task = findTask(id);
                if (!task) unknown.push({ taskId: id, reason: "no task with this id" });
                else if (!seen.has(task.getId())) {
                    seen.add(task.getId());
                    tasks.push(task);
                }
            }
            const running = tasks.filter(isArchiveBusy).map((t) => t.getId());
            const ready = tasks.filter((t) => !isArchiveBusy(t));
            if (ready.length === 0) {
                throw new AgentToolError(
                    unknown.length > 0 && running.length === 0
                        ? `None of those ids is a task: ${unknown.map((u) => u.taskId).join(", ")}. Use list_tasks to find ids.`
                        : "Every one of those tasks is being processed right now.",
                    unknown.length > 0 && running.length === 0 ? "not-found" : "running"
                );
            }

            // Counted only once the user has said yes: a declined question changes nothing, so it costs nothing.
            const overBudget = ctx.turn.checkBudget(ready.map((t) => t.getId()));
            if (overBudget) throw new AgentToolError(overBudget, "budget");

            const answer = await ctx.confirm({
                title: `Let Claude archive ${ready.length} ${ready.length === 1 ? "task" : "tasks"}?`,
                message:
                    `Claude wants to move ${ready.length} ${ready.length === 1 ? "task" : "tasks"} to the archive.\n\n` +
                    ready
                        .slice(0, 8)
                        .map((t) => `• ${archiveLabel(t)}`)
                        .join("\n") +
                    (ready.length > 8 ? `\n…and ${ready.length - 8} more` : "") +
                    "\n\nThey are kept there: you can restore them from the Archive window.",
                // The safe answer first.
                choices: [
                    { label: "Cancel", tone: "muted" },
                    { label: "Archive", tone: "primary" },
                ],
                accent: "#d97757",
            });
            // Stop was pressed (or the message ended) while the dialog was open: it was taken off the screen (answer
            // null) and nothing is archived. Checked first, so that is not mistaken for the user saying no.
            if (ctx.turn.isEnded || ctx.signal.aborted) {
                return {
                    archived: 0,
                    cancelled: true,
                    note: "The conversation had moved on before the answer: nothing was archived.",
                };
            }
            if (answer !== 1)
                return {
                    archived: 0,
                    cancelled: true,
                    note: "The user did not allow it. Do not ask again unless they do.",
                };
            // The dialog may have stayed open a while: a task started meanwhile is left out too.
            const startedSince = ready.filter(isArchiveBusy).map((t) => t.getId());
            const toArchive = ready.filter((t) => !isArchiveBusy(t));
            const leftOut = [...running, ...startedSince];
            if (toArchive.length === 0)
                throw new AgentToolError("Every one of those tasks is being processed right now.", "running");

            const got = ctx.turn.acquire(toArchive.map((t) => t.getId()));
            if ("ended" in got) return { archived: 0, cancelled: true, note: "The turn ended: nothing was archived." };
            if ("heldBy" in got)
                throw new AgentToolError("Some of those tasks are being edited right now. Try again.", "locked");
            try {
                const archived = SessionManager.getInstance().archiveTasks(toArchive.map((t) => t.getId()));
                ctx.turn.count(toArchive.map((t) => t.getId()));
                return {
                    archived,
                    ...(leftOut.length > 0 ? { leftOut } : {}),
                    ...(unknown.length > 0 ? { skipped: unknown } : {}),
                };
            } finally {
                got.lease.release();
            }
        }),
});

/** How many links one add_tasks call takes: a long list is better read by the user than pushed in by a loop. */
const MAX_ADDED_PER_CALL = 50;

export const addTasks = defineAgentTool<{ urls: string[] }>({
    name: "add_tasks",
    summary:
        "Adds music links to the user's task list, as new tasks (the same as pasting them into the app): a track, album or playlist link of a platform the app reads. Links already in the list or in the archive are skipped and reported. The tasks are only added, not started (run_task, run_metadata and run_download start them). Use it for links the user gave you or that search_music found for what they asked.",
    kind: "write",
    locks: "none",
    undoable: true,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["urls"],
        properties: {
            urls: {
                type: "array",
                items: { type: "string", minLength: 8, maxLength: 500 },
                minItems: 1,
                maxItems: MAX_ADDED_PER_CALL,
            },
        },
    },
    example: { urls: ["https://open.spotify.com/track/4rye8ZgoRgbQPfgBqxjfqG"] },
    describeCall: (input) => `add_tasks (${input.urls.length})`,
    run: async ({ urls }, ctx) => {
        // A short link says whether it is a track or an album only once followed (never throws: one that cannot be
        // followed stays as it was).
        const resolved = await urlParserRegistry.resolveAll(urls.map((raw) => raw.trim()));
        const existing = new Set(allTasks().map((t) => t.getId()));
        const archived = getArchivedTaskIds(SessionManager.getInstance().getCurrentSession());
        const seen = new Set<string>();
        const fresh: string[] = [];
        const skipped: { url: string; reason: string }[] = [];
        for (const url of resolved) {
            let parsed: ReturnType<typeof urlParserRegistry.parse> = null;
            try {
                parsed = /^https?:\/\//i.test(url) ? urlParserRegistry.parse(url) : null;
            } catch {
                /* not a link */
            }
            const id = taskIdFromUrl(url);
            if (!parsed) skipped.push({ url, reason: "not a link of a platform the app reads" });
            else if (parsed.type !== "track" && parsed.type !== "album" && parsed.type !== "playlist")
                skipped.push({ url, reason: "only track, album and playlist links can be added" });
            else if (existing.has(id)) skipped.push({ url, reason: "already in the list" });
            else if (archived.has(id)) skipped.push({ url, reason: "in the archive (the user can restore it there)" });
            else if (seen.has(id)) skipped.push({ url, reason: "given twice" });
            else {
                seen.add(id);
                fresh.push(url);
            }
        }
        if (fresh.length === 0) return { added: [], skipped };

        const overBudget = ctx.turn.spend(fresh.map((u) => taskIdFromUrl(u)));
        if (overBudget) throw new AgentToolError(overBudget, "budget");

        const tasks = createTasksFromUrls(fresh, { toTag: true, toDownload: false });
        importTasks(tasks);
        const ids = tasks.map((t) => t.getId());
        // What each new track looked like when it was added: one the user has edited since is theirs now.
        const addedRevision = new Map(
            tasks.filter((t) => t instanceof DownloadTask).map((t) => [t.getId(), (t as DownloadTask).getRevision()])
        );
        agentJournal.record({
            tool: "add_tasks",
            label: `add_tasks → ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`,
            checks: [],
            // Only the ones nobody has started or touched yet: a task that was started, or that the user edited
            // (overrides, links, choices), stays: removing it would lose what they typed.
            restore: () => {
                const orchestrator = TaskOrchestrator.getInstance();
                const untouched = orchestrator
                    .getTasks()
                    .filter((t) => {
                        if (!ids.includes(t.getId()) || t.getAttributes()?.state !== "pending") return false;
                        const added = addedRevision.get(t.getId());
                        return added === undefined || !(t instanceof DownloadTask) || t.getRevision() === added;
                    })
                    .map((t) => t.getId());
                if (untouched.length > 0) orchestrator.removeTasks(untouched);
            },
        });
        return {
            added: tasks.map((t) => ({ taskId: t.getId(), url: t.getAttributes()?.userInput.url })),
            skipped,
            note: "Added to the list, not started: start them with run_task / run_metadata, or the user does.",
        };
    },
});

export const writeTools = [
    setMetadataOverride,
    selectSource,
    rejectSource,
    addUserSource,
    addTasks,
    rediscover,
    archiveTasks,
];
