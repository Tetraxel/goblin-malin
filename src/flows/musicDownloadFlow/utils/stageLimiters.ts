import { Semaphore } from "#utils/semaphore";

/**
 * Process-wide concurrency budgets for the two heavy pipeline stages, shared by every
 * task. The orchestrator's task-level cap decides how many tasks are in-flight; these
 * decide how many may be doing the *same kind of work* at once:
 *
 * - `metadataLimiter` throttles metadata + discovery (rate-limited third-party APIs).
 * - `downloadLimiter` throttles concurrent yt-dlp downloads (network/IO bound).
 *
 * This is what lets download parallelism scale up (raise the task cap + download limit)
 * without also multiplying concurrent API calls. Limits are seeded from defaults and
 * kept in sync with user settings via {@link applyStageConcurrency}.
 */
export const metadataLimiter = new Semaphore(3);
export const downloadLimiter = new Semaphore(4);

export function applyStageConcurrency(maxParallelMetadata: number, maxParallelDownloads: number): void {
    metadataLimiter.setLimit(maxParallelMetadata);
    downloadLimiter.setLimit(maxParallelDownloads);
}
