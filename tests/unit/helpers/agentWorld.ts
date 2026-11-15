import { notificationScheduler } from "#base/notificationScheduler";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { taskLocks } from "#base/task/taskLock";
import { AgentTurn } from "#base/agent/agentTurn";
import { agentToolRegistry } from "#base/agent/agentToolRegistry";
import { registerAgentTools } from "#flows/musicDownloadFlow/agent/registerAgentTools";
import { agentJournal } from "#flows/musicDownloadFlow/agent/taskAccess";
import { batchPlans } from "#flows/musicDownloadFlow/agent/batchPlans";
import { reviveTrackTask } from "#flows/musicDownloadFlow/utils/buildTrackTask";
import { type DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { type TrackDownloadSource, type TrackDownloadTask, type TrackMetadata } from "#flows/musicDownloadFlow/types";

/** A small world of tracks for the agent tests: real `DownloadTask`s in the real orchestrator, no network. */

export const meta = (id: string, title: string, artist = "Some Artist", platform = "spotify"): TrackMetadata =>
    ({
        id,
        trackName: title,
        artists: [{ type: "artist", name: artist }],
        url: `https://open.spotify.com/track/${id}`,
        uri: `${platform.toUpperCase()}::TRACK::${id}`,
        platform,
        apiProvider: platform,
        fetchedAt: new Date(),
        type: "track",
    }) as unknown as TrackMetadata;

export function downloadedRow(provider: "ytdlp" | "soulseek", what: string, track: TrackMetadata): TrackDownloadSource {
    return {
        state: "downloaded",
        provider,
        track,
        downloadedAt: new Date(),
        selected: false,
        providerDetail: provider === "soulseek" ? "someuser" : undefined,
        candidate: { name: what },
        localFile: { state: "found", path: `/tmp/${what}`, name: what, extension: "flac" },
        fileInfo: { format: "flac", sizeBytes: 1000, durationMs: 200_000, embeddedTags: {} },
    };
}

export function makeTrack(id: string, title: string, patch: Partial<TrackDownloadTask> = {}): DownloadTask {
    return reviveTrackTask({
        id,
        initialInput: `https://open.spotify.com/track/${id}`,
        attributes: {
            kind: "track",
            state: "finished",
            userInput: { type: "url", url: `https://open.spotify.com/track/${id}` },
            metadataGroups: [
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 0,
                    results: [
                        {
                            metadata: meta(id, title),
                            isPrimaryInput: true,
                            isFavorited: false,
                            isRejected: false,
                            rank: 0,
                            discoverySources: [],
                        },
                    ],
                },
            ],
            primaryMetadataFetched: true,
            metadataOverride: {},
            downloadSources: [],
            toTag: true,
            toDownload: false,
            ...patch,
        },
    });
}

/** Resets everything the agent keeps in memory and puts `tasks` in the list. */
export function installWorld(tasks: DownloadTask[]): void {
    notificationScheduler.setSyncMode(true);
    registerAgentTools();
    taskLocks.clear();
    agentJournal.clear();
    batchPlans.clear();
    TaskOrchestrator.getInstance().setTasks(tasks);
}

export type CallResult = { isError: boolean; text: string; json: any };

/** Calls a tool as the MCP server would, on a turn (a fresh one by default). */
export async function callTool(name: string, input: unknown, turn = new AgentTurn()): Promise<CallResult> {
    const outcome = await agentToolRegistry.execute(name, input, turn);
    let json: unknown;
    try {
        json = JSON.parse(outcome.text);
    } catch {
        json = undefined;
    }
    return { isError: outcome.isError, text: outcome.text, json };
}
