import { TrackDownloadSource } from "#flows/musicDownloadFlow/types";

// Lower rank = preferred. Sources without fileInfo/provenance (or a still-failed
// source) rank last so they're never picked over a real downloaded file.
function provenanceRank(source: TrackDownloadSource): number {
    switch (source.fileInfo?.provenance) {
        case "lossless":
            return 0;
        case "lossy":
            return 1;
        case "lossy-transcode":
            return 2;
        default:
            return 3;
    }
}

/**
 * Pick which downloaded source should be auto-selected. When `preferLossless`
 * is on: lossless first, then highest-bitrate lossy, then transcodes, with the
 * first-downloaded source as a tiebreaker. When off: the first successfully
 * downloaded source, in provider-registry order (previous/legacy behavior).
 *
 * Returns -1 if no source has `state === "downloaded"`.
 */
export function pickAutoSelectedIndex(sources: TrackDownloadSource[], preferLossless: boolean): number {
    const downloadedIndices = sources.reduce<number[]>((acc, s, i) => {
        if (s.state === "downloaded") acc.push(i);
        return acc;
    }, []);

    if (downloadedIndices.length === 0) return -1;
    if (!preferLossless) return downloadedIndices[0];

    return downloadedIndices.reduce((bestIdx, idx) => {
        const best = sources[bestIdx];
        const candidate = sources[idx];
        const bestRank = provenanceRank(best);
        const candidateRank = provenanceRank(candidate);

        if (candidateRank !== bestRank) return candidateRank < bestRank ? idx : bestIdx;

        // Same provenance tier — prefer the higher real bitrate when both are lossy.
        const bestBitrate = best.fileInfo?.bitrateKbps ?? 0;
        const candidateBitrate = candidate.fileInfo?.bitrateKbps ?? 0;
        return candidateBitrate > bestBitrate ? idx : bestIdx;
    }, downloadedIndices[0]);
}
