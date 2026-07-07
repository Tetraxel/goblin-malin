import { Task } from "#base/task/task";
import { TaskScoped } from "#base/task/taskContext";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { Logger } from "#base/logger/logger";
import { StatusAttributes, StatusType } from "#base/task/task-status";
import { SafeAction } from "#utils/decorators";
import { throwIfAborted } from "#utils/errors";
import { CollectionDownloadTask } from "../types";
import { metadataServiceRegistry } from "../registries";
import { getMusicSettings } from "../settings";
import { metadataLimiter } from "./stageLimiters";
import { buildTrackTask } from "./buildTrackTask";
import { taskIdFromUrl } from "./taskId";

/**
 * Parent task for an album/playlist URL. Doesn't fetch track metadata itself —
 * start()/refetch() resolve the recognizing service's expandCollection() and spawn
 * real DownloadTask children (tagged parentTaskId) into the same flat orchestrator
 * queue. Newly-discovered children are immediately queued to run (respecting their
 * inherited toTag/toDownload flags) — auto-imported tracks shouldn't sit idle.
 */
export class CollectionTask extends Task<CollectionDownloadTask> {
    // Own in-flight guard — manual per-task actions call start()/restart()/refetch()
    // directly (not through the orchestrator's pump), so `this.running` isn't a
    // reliable "already fetching" signal here. Used to make the live-refresh
    // scheduler's tick a safe no-op against a concurrent manual fetch.
    private fetching = false;

    constructor({
        id,
        initialInput,
        attributes,
        logger,
        initialStatus,
    }: {
        id: string;
        initialInput?: string;
        attributes?: CollectionDownloadTask;
        logger: Logger;
        initialStatus?: StatusAttributes;
    }) {
        super({ id, initialInput, attributes, logger, initialStatus });
    }

    public override getLogLabel(): string | undefined {
        const attrs = this.getAttributes();
        return attrs?.name ?? attrs?.userInput.url ?? this.getInitialInput();
    }

    public isFetching(): boolean {
        return this.fetching;
    }

    @TaskScoped()
    @SafeAction("Start collection task")
    async start(signal?: AbortSignal): Promise<void> {
        const state = this.getAttributes()?.state;
        if (state !== "pending" && state !== "stopped") {
            this.logger.info(`Skipping because collection already processed ${this.getInitialInput()}`);
            return;
        }
        if (this.fetching) return;

        this.updateAttributes({ state: "running", error: undefined });

        try {
            throwIfAborted(signal);
            await this.fetchAndSpawn(signal);
            this.updateAttributes({ state: "finished" });
            this.status.set({ type: StatusType.Success, message: this.summaryMessage() });
        } catch (error) {
            if ((error as Error).name === "AbortError") {
                this.updateAttributes({ state: "stopped" });
                this.status.set({ type: StatusType.Skipped, message: "Stopped" });
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.updateAttributes({ state: "failed", error: message });
            this.status.set({ type: StatusType.Error, message: "Failed to fetch track list" });
            throw error;
        }
    }

    @TaskScoped()
    @SafeAction("Restart collection task")
    async restart(): Promise<void> {
        const attrs = this.getAttributes();
        if (attrs?.childTaskIds.length) {
            TaskOrchestrator.getInstance().removeTasks(attrs.childTaskIds);
        }
        this.updateAttributes({
            state: "pending",
            childTaskIds: [],
            name: undefined,
            ownerName: undefined,
            totalCount: undefined,
            truncated: undefined,
            error: undefined,
        });
        this.status.clear();
        await this.start();
    }

    /** Idempotent re-list: adds newly-discovered tracks, leaves existing children untouched. */
    @TaskScoped()
    @SafeAction("Refetch collection task")
    async refetch(signal?: AbortSignal): Promise<void> {
        if (this.fetching) return;
        try {
            await this.fetchAndSpawn(signal);
            this.updateAttributes({ state: "finished", error: undefined });
            this.status.set({ type: StatusType.Success, message: this.summaryMessage() });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.updateAttributes({ error: message });
            this.status.set({ type: StatusType.Error, message: "Refetch failed" });
            throw error;
        }
    }

    toggleCollapsed(): void {
        const attrs = this.getAttributes();
        if (!attrs) return;
        this.updateAttributes({ collapsed: !attrs.collapsed });
    }

    toggleLive(): void {
        const attrs = this.getAttributes();
        if (!attrs || attrs.collectionKind !== "playlist") return;
        this.updateAttributes({ live: { ...attrs.live, enabled: !(attrs.live?.enabled ?? true) } });
    }

    private summaryMessage(): string {
        const attrs = this.getAttributes();
        const count = attrs?.totalCount ?? attrs?.childTaskIds.length ?? 0;
        const label = count === 1 ? "track" : "tracks";
        return attrs?.truncated ? `${count} ${label} (truncated)` : `${count} ${label}`;
    }

    // Shared by start() (fresh) and refetch() (idempotent — only childTaskIds already
    // present are skipped, so calling this again just appends anything new).
    private async fetchAndSpawn(signal?: AbortSignal): Promise<void> {
        this.fetching = true;
        try {
            const attrs = this.getAttributes();
            if (!attrs) throw new Error("Collection task missing attributes");

            const url = attrs.userInput.url;
            const serviceKey = attrs.recognizedServiceKey;
            if (!serviceKey) {
                throw new Error(`No metadata service recognized the URL: ${url}`);
            }
            const expand = metadataServiceRegistry.getConstructor(serviceKey)?.expandCollection;
            if (!expand) {
                throw new Error(`Service "${serviceKey}" does not support expanding albums/playlists`);
            }

            this.status.set({
                type: StatusType.Processing,
                message: attrs.childTaskIds.length > 0 ? "Refetching…" : "Fetching track list…",
                timeTracking: true,
                progress: 0,
            });

            throwIfAborted(signal);
            const expansion = await metadataLimiter.run(() => expand(url, this.logger, this));
            throwIfAborted(signal);

            const { defaultMaxTracks } = getMusicSettings().collections;
            const cappedUrls = expansion.trackUrls.slice(0, defaultMaxTracks);
            const truncated = Boolean(expansion.truncated) || expansion.trackUrls.length > cappedUrls.length;

            const orchestrator = TaskOrchestrator.getInstance();
            const existingChildIds = new Set(attrs.childTaskIds);
            const existingOrchestratorIds = new Set(orchestrator.getTasks().map((t) => t.getId()));

            const newChildren = [];
            const newChildIds: string[] = [];
            for (const trackUrl of cappedUrls) {
                const id = taskIdFromUrl(trackUrl);
                if (existingChildIds.has(id)) continue; // already a child (refetch path)
                if (existingOrchestratorIds.has(id)) {
                    // Same track already exists elsewhere in the queue (e.g. imported
                    // standalone before this collection) — don't duplicate/crash on the
                    // id collision, just leave it where it is.
                    this.logger.debug(`Skipping track already in queue: ${trackUrl}`);
                    continue;
                }
                newChildren.push(
                    buildTrackTask(trackUrl, {
                        toTag: attrs.toTag,
                        toDownload: attrs.toDownload,
                        parentTaskId: this.getId(),
                    })
                );
                newChildIds.push(id);
            }
            if (newChildren.length > 0) {
                orchestrator.addTasks(newChildren);
                // Auto-imported tracks start working right away rather than sitting
                // pending until a manual Run All. Filtered to just the new ids so this
                // doesn't touch unrelated pending tasks; if a broader run is already in
                // progress this is a harmless no-op — that pump already re-scans
                // candidates (now including these) after every task it settles.
                orchestrator.processTasks(new Set(newChildIds)).catch(() => {});
            }

            this.updateAttributes({
                name: expansion.name,
                ownerName: expansion.ownerName,
                totalCount: expansion.totalCount,
                truncated,
                childTaskIds: [...attrs.childTaskIds, ...newChildIds],
                live:
                    attrs.collectionKind === "playlist"
                        ? { enabled: attrs.live?.enabled ?? true, lastFetchedAt: new Date() }
                        : attrs.live,
            });
        } finally {
            this.fetching = false;
        }
    }
}
