/**
 * How many files a track downloads (Settings → Download → "Download strategy").
 *
 * Pure data, no I/O: the Settings row, the pipeline and the tests all read the same table. The strategy is applied
 * generically — the pipeline never looks at which provider it is talking to.
 *
 * - `best`: providers are asked in order, and the first one that downloads a file ends the search.
 * - `each`: every provider downloads its best source — one file per provider (the default, and the behaviour
 *   before this setting existed).
 * - `all`: every provider downloads every source it found, up to {@link MAX_DOWNLOADS_PER_PROVIDER} files each.
 */
export type DownloadStrategyKey = "best" | "each" | "all";

export const DOWNLOAD_STRATEGY_KEYS: readonly DownloadStrategyKey[] = ["best", "each", "all"];

export const DEFAULT_DOWNLOAD_STRATEGY: DownloadStrategyKey = "each";

/** Hard cap on the files one provider downloads for one track, so the temporary folder is never flooded. */
export const MAX_DOWNLOADS_PER_PROVIDER = 5;

/** A stored setting value as a known strategy; anything unknown (an old or hand-edited file) is the default. */
export function parseDownloadStrategy(value: unknown): DownloadStrategyKey {
    return typeof value === "string" && (DOWNLOAD_STRATEGY_KEYS as readonly string[]).includes(value)
        ? (value as DownloadStrategyKey)
        : DEFAULT_DOWNLOAD_STRATEGY;
}

/** How many files one provider may download for one track under this strategy (never above the cap). */
export function maxDownloadsPerProvider(strategy: DownloadStrategyKey): number {
    return strategy === "all" ? MAX_DOWNLOADS_PER_PROVIDER : 1;
}

/** Whether the providers after the first one that downloaded a file are left alone. */
export function stopsAtFirstDownload(strategy: DownloadStrategyKey): boolean {
    return strategy === "best";
}

/** The line shown under the setting: what the chosen strategy does. */
export const DOWNLOAD_STRATEGY_NOTES: Readonly<Record<DownloadStrategyKey, string>> = {
    best: "Stops at the first provider that downloads a file; the others are not used.",
    each: "Every provider downloads its best source: one file per provider.",
    all: `Every provider downloads all the sources it finds, at most ${MAX_DOWNLOADS_PER_PROVIDER} files each.`,
};
