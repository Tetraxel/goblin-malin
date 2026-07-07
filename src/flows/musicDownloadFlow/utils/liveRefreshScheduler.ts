import { TaskOrchestrator } from "#base/task/orchestrator";
import { globalLogger } from "#base/logger/logger";
import { CollectionTask } from "./collectionTask";
import { getMusicSettings } from "../settings";

// How often the scheduler checks for due playlists — independent of the user's
// configurable refresh interval (in seconds), but small enough not to bottleneck it
// now that interval is seconds-granular rather than minutes.
const CHECK_INTERVAL_MS = 5_000;

const logger = globalLogger.createChild({ service: "LiveRefreshScheduler" });

/**
 * Polls live-enabled playlist tasks and refetches those that are due. There's no
 * Spotify push/webhook API for "this playlist changed" — polling is the only option.
 * A singleton timer (not one per row) so the cost stays flat regardless of how many
 * playlists are live-enabled.
 */
class LiveRefreshScheduler {
    private timer: ReturnType<typeof setInterval> | null = null;

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
        this.timer.unref?.();
    }

    stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    private tick(): void {
        const intervalMs = Math.max(1, getMusicSettings().collections.defaultLiveRefreshIntervalSeconds) * 1000;
        const now = Date.now();

        for (const task of TaskOrchestrator.getInstance().getTasks()) {
            const attrs = task.getAttributes() as
                | { kind?: string; collectionKind?: string; live?: { enabled: boolean; lastFetchedAt?: Date } }
                | undefined;
            if (attrs?.kind !== "collection" || attrs.collectionKind !== "playlist" || !attrs.live?.enabled) continue;
            if (task.running) continue;

            const collectionTask = task as unknown as CollectionTask;
            if (collectionTask.isFetching()) continue;

            const lastFetchedAt = attrs.live.lastFetchedAt?.getTime() ?? 0;
            if (now - lastFetchedAt < intervalMs) continue;

            collectionTask.refetch().catch((error) => {
                logger.warn(
                    `Live refresh failed for ${task.getId()}: ${error instanceof Error ? error.message : error}`
                );
            });
        }
    }
}

export const liveRefreshScheduler = new LiveRefreshScheduler();
