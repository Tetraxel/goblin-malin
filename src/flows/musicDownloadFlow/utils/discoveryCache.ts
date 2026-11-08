import { NEGATIVE_RESULT_TTL_MS } from "#utils/cache";
import type { DiscoveryResult } from "#flows/musicDownloadFlow/types";

/**
 * `@Cached` TTL for discovery results: a "nothing found" answer (no tracks, or a `notFound` anchor)
 * is only kept for a day instead of the 90-day default — the catalogue may gain the track tomorrow,
 * and a transient upstream failure mapped to "not found" must not stick for months.
 */
export function discoveryResultTtl(result: unknown): number | undefined {
    const r = result as DiscoveryResult | null;
    const negative = !r || !r.tracks || r.tracks.length === 0 || r.anchor?.state === "notFound";
    return negative ? NEGATIVE_RESULT_TTL_MS : undefined;
}
