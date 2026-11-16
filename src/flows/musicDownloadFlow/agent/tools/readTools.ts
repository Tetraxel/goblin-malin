import { AgentToolError, defineAgentTool } from "#base/agent/agentTool";
import { urlParserRegistry } from "#base/urlParser";
import { taskLocks } from "#base/task/taskLock";
import { untilAborted } from "#utils/errors";
import { withTimeout } from "#utils/withTimeout";
import { buildTrackTask } from "../../utils/buildTrackTask";
import { MusicBrainzClient } from "../../services/apis/musicbrainz-client";
import { type TrackDownloadTask } from "../../types";
import { allTasks, requireDownloadTask, findTask } from "../taskAccess";
import {
    LIST_PAGE_SIZE,
    TASK_PROBLEMS,
    describeTask,
    filterTasks,
    sourcesView,
    summarizeTask,
    taskLogs,
    type TaskFilter,
} from "../views";

const isLocked = (id: string) => taskLocks.isLocked(id);

/** How long lookup_url waits for a platform to read one link. */
const LOOKUP_TIMEOUT_MS = 25_000;

type ListInput = { filter?: TaskFilter; cursor?: string };

export const listTasks = defineAgentTool<ListInput>({
    name: "list_tasks",
    summary:
        "Lists the user's tasks (tracks, albums, playlists and groups the user made), 25 per page, with their id, title, artists, state and revision. Use a filter to narrow it; pass the cursor of the previous page for the next one.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        properties: {
            filter: {
                type: "object",
                additionalProperties: false,
                description: "Every given field must match.",
                properties: {
                    ids: {
                        type: "array",
                        items: { type: "string" },
                        maxItems: 200,
                        description: "Only these task ids.",
                    },
                    query: {
                        type: "string",
                        maxLength: 200,
                        description: "Text found in the title, an artist or the link.",
                    },
                    state: { type: "string", enum: ["pending", "running", "finished", "failed", "stopped"] },
                    kind: { type: "string", enum: ["track", "collection"] },
                    problem: {
                        type: "string",
                        enum: [...TASK_PROBLEMS],
                        description:
                            "no_source: downloads were searched and none is usable; no_metadata: no title yet; title_noise: the title has video-site noise like (Official Video); needs_review: MusicBrainz wants the user to check the release; not_saved: no file saved yet.",
                    },
                },
            },
            cursor: { type: "string", maxLength: 12, description: "The `next` value of the previous page." },
        },
    },
    example: { filter: { problem: "title_noise" } },
    describeCall: (input) => `list_tasks${input.filter ? ` ${JSON.stringify(input.filter).slice(0, 80)}` : ""}`,
    run: (input) => {
        const matching = filterTasks(allTasks(), input.filter ?? {});
        const start = Math.max(0, Number.parseInt(input.cursor ?? "0", 10) || 0);
        const page = matching.slice(start, start + LIST_PAGE_SIZE);
        return {
            total: matching.length,
            tasks: page.map((t) => summarizeTask(t, isLocked(t.getId()))),
            ...(start + LIST_PAGE_SIZE < matching.length ? { next: String(start + LIST_PAGE_SIZE) } : {}),
        };
    },
});

export const getTask = defineAgentTool<{ taskId: string }>({
    name: "get_task",
    summary:
        "Reads one task in full: the compiled metadata (and which platform each field came from), the user's overrides, what each platform found, the links the user added, the download rows and the MusicBrainz verdict. Its `revision` is what a write must carry.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: { taskId: { type: "string", minLength: 1, maxLength: 200 } },
    },
    example: { taskId: "task-1a2b3c" },
    describeCall: (input) => `get_task ${input.taskId}`,
    run: ({ taskId }) => {
        const task = findTask(taskId);
        if (!task) throw new AgentToolError(`No task with id "${taskId}". Use list_tasks to find ids.`, "not-found");
        // The task's own id: the model may have written it without "task:".
        return describeTask(task, isLocked(task.getId()));
    },
});

export const getSources = defineAgentTool<{ taskId: string }>({
    name: "get_sources",
    summary:
        "Lists the download rows of a track: for each its `id` (what select_source and reject_source take), provider, state, whether it is selected or rejected, and its format and quality.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: { taskId: { type: "string", minLength: 1, maxLength: 200 } },
    },
    example: { taskId: "task-1a2b3c" },
    describeCall: (input) => `get_sources ${input.taskId}`,
    run: ({ taskId }) => {
        const task = requireDownloadTask(taskId);
        return { revision: task.getRevision(), ...sourcesView(task.getAttributes() as TrackDownloadTask) };
    },
});

export const getLogs = defineAgentTool<{ taskId: string; cursor?: string }>({
    name: "get_logs",
    summary:
        "Reads a page of one task's log (what happened while it was processed), oldest first. The user's name and home folder are hidden.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: {
            taskId: { type: "string", minLength: 1, maxLength: 200 },
            cursor: { type: "string", maxLength: 12, description: "The `next` value of the previous page." },
        },
    },
    example: { taskId: "task-1a2b3c" },
    describeCall: (input) => `get_logs ${input.taskId}`,
    run: ({ taskId, cursor }) => {
        const task = findTask(taskId);
        if (!task) throw new AgentToolError(`No task with id "${taskId}". Use list_tasks to find ids.`, "not-found");
        return taskLogs(task, cursor);
    },
});

export const lookupUrl = defineAgentTool<{ url: string }>({
    name: "lookup_url",
    summary:
        "Reads a music link through the metadata service that owns it (the same ones the app uses) and returns what it says about the track: title, artists, album, ISRC. Nothing is added to the user's tasks.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: { url: { type: "string", minLength: 8, maxLength: 500 } },
    },
    example: { url: "https://open.spotify.com/track/4rye8ZgoRgbQPfgBqxjfqG" },
    describeCall: (input) => `lookup_url ${input.url.slice(0, 60)}`,
    run: async ({ url }, ctx) => {
        let parsed: ReturnType<typeof urlParserRegistry.parse> = null;
        try {
            parsed = urlParserRegistry.parse(url.trim());
        } catch {
            /* not a link */
        }
        if (!parsed) return { recognized: false, note: "No service of the app reads this link." };
        if (parsed.type !== "track") {
            return {
                recognized: true,
                platform: parsed.platform,
                type: parsed.type,
                note: "Only track links can be read here.",
            };
        }
        // A throwaway task, never added to the list: it only gives the services somewhere to report to.
        const scratch = buildTrackTask(url.trim(), { toTag: true, toDownload: false });
        try {
            // Stop ends the wait at once, and a service that never answers ends it after a while (search_music has the
            // same two limits): the request in flight finishes by itself and its answer is dropped.
            await withTimeout(
                untilAborted(scratch.startPrimaryMetadataFetching(), ctx.signal),
                LOOKUP_TIMEOUT_MS,
                "the platform did not answer in time"
            );
        } catch (error) {
            // Stop is not a failed lookup: let the turn end instead of answering "could not read the link".
            if (ctx.signal.aborted) throw error;
            return {
                recognized: true,
                platform: parsed.platform,
                fetched: false,
                error: error instanceof Error ? error.message.slice(0, 200) : "could not read the link",
            };
        }
        const primary = scratch
            .getAttributes()
            ?.metadataGroups.flatMap((g) => g.results)
            .find((r) => r.isPrimaryInput)?.metadata;
        if (!primary) return { recognized: true, platform: parsed.platform, fetched: false };
        return {
            recognized: true,
            fetched: true,
            platform: primary.platform,
            title: primary.trackName,
            artists: primary.artists.map((a) => a.name),
            album: primary.album?.albumName,
            releaseDate: primary.album?.releaseDate,
            isrc: primary.isrc,
            durationMs: primary.duration,
            url: primary.url,
        };
    },
});

type MbInput = { isrc?: string; barcode?: string; url?: string; title?: string; artist?: string };

export const musicbrainzLookup = defineAgentTool<MbInput>({
    name: "musicbrainz_lookup",
    summary:
        "Asks MusicBrainz (read-only) about a recording by ISRC, a release by barcode, by a streaming link, or by title and artist. Slow: MusicBrainz is rate limited, so ask once, with the most precise key you have.",
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        properties: {
            isrc: { type: "string", maxLength: 20 },
            barcode: { type: "string", maxLength: 20 },
            url: {
                type: "string",
                maxLength: 500,
                description: "A streaming link of an album, as MusicBrainz lists it.",
            },
            title: { type: "string", maxLength: 200, description: "An album title (a release search), with `artist`." },
            artist: { type: "string", maxLength: 200 },
        },
    },
    example: { isrc: "FRT092400049" },
    describeCall: (input) =>
        `musicbrainz_lookup ${input.isrc ?? input.barcode ?? input.url ?? input.title ?? ""}`.trim(),
    run: async (input) => {
        if (!input.isrc && !input.barcode && !input.url && !input.title) {
            throw new AgentToolError("Give at least one of isrc, barcode, url or title.", "invalid");
        }
        const client = new MusicBrainzClient();
        const out: Record<string, unknown> = {};
        const release = (r: {
            id: string;
            title: string;
            date?: string;
            country?: string;
            barcode?: string;
            artists: { name: string }[];
        }) => ({
            id: r.id,
            title: r.title,
            artists: r.artists.map((a) => a.name),
            date: r.date,
            country: r.country,
            barcode: r.barcode,
        });
        const attempt = async (key: string, work: () => Promise<unknown>) => {
            try {
                out[key] = await work();
            } catch (error) {
                out[key] = { error: error instanceof Error ? error.message.slice(0, 160) : "lookup failed" };
            }
        };
        if (input.isrc) {
            await attempt("recordings", async () =>
                (await client.findRecordingsByIsrc(input.isrc!.replace(/[\s-]/g, "").toUpperCase()))
                    .slice(0, 3)
                    .map((r) => ({
                        id: r.id,
                        title: r.title,
                        artists: r.artists.map((a) => a.name),
                        lengthMs: r.lengthMs,
                        releases: r.releases.slice(0, 5).map(release),
                    }))
            );
        }
        if (input.barcode) {
            await attempt("releases", async () =>
                (await client.findReleasesByBarcode(input.barcode!)).slice(0, 5).map(release)
            );
        }
        if (input.url) {
            await attempt("releasesByUrl", async () =>
                (await client.findReleasesByUrl(input.url!)).slice(0, 5).map(release)
            );
        }
        if (input.title) {
            await attempt("search", async () =>
                (await client.searchReleases({ title: input.title!, artist: input.artist }))
                    .slice(0, 5)
                    .map((r) => ({ ...release(r), score: r.score }))
            );
        }
        return out;
    },
});

type SearchInput = { query: string; platforms?: string[]; limit?: number };

export const searchMusic = defineAgentTool<SearchInput>({
    name: "search_music",
    summary:
        'Searches music by free text on the streaming platforms the app reads (the search box of each one): a title, an artist, "Title - Artist remix", "Artist live"… Returns tracks with their link, title, artists, album and duration. Nothing is added to the user\'s tasks: to add what you found, pass the links to add_tasks. One request per platform, so search once with a good query and only vary it if the results are poor.',
    kind: "read",
    locks: "none",
    undoable: false,
    input: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
            query: {
                type: "string",
                minLength: 2,
                maxLength: 200,
                description: "What to search for, as you would type it.",
            },
            platforms: {
                type: "array",
                items: { type: "string", minLength: 1, maxLength: 40 },
                maxItems: 8,
                description: "Only these platforms (as named in the results). Default: every platform that can search.",
            },
            limit: { type: "integer", minimum: 1, maximum: 20, description: "Results per platform (default 8)." },
        },
    },
    example: { query: "Justice Neverender remix", limit: 8 },
    describeCall: (input) => `search_music "${input.query.slice(0, 60)}"`,
    run: async ({ query, platforms, limit }, ctx) => {
        // A throwaway task, never added to the list: it only gives the services somewhere to report to.
        const scratch = buildTrackTask("https://example.invalid/search", { toTag: false, toDownload: false });
        // Stop ends the wait at once (the requests in flight finish by themselves, and their answers are dropped).
        const outcomes = await untilAborted(scratch.searchCatalog(query.trim(), { platforms, limit }), ctx.signal);
        if (outcomes.length === 0) {
            return { query, note: "No platform that can search is switched on (Settings → Metadata)." };
        }
        return {
            query,
            platforms: outcomes.map((outcome) => ({
                platform: outcome.platform,
                ...(outcome.error ? { error: outcome.error } : {}),
                results: outcome.results.map((track) => ({
                    title: track.trackName,
                    artists: track.artists.map((a) => a.name),
                    album: track.album?.albumName,
                    year: track.album?.releaseDate?.slice(0, 4),
                    durationMs: track.duration,
                    isrc: track.isrc,
                    url: track.url,
                })),
            })),
        };
    },
});

export const readTools = [listTasks, getTask, getSources, getLogs, lookupUrl, searchMusic, musicbrainzLookup];
