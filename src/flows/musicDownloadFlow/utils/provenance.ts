import { FileInfo } from "#flows/musicDownloadFlow/types";

export type ProvenanceTone = "success" | "warning" | "neutral";

export type ProvenanceDisplay = {
    /** Compact badge for the source row, e.g. "FLAC", "FLAC*", "MP3 320". */
    badge: string;
    /** Semantic tone the caller maps to a theme.status token. */
    tone: ProvenanceTone;
    /** Longer explanation for the detail panel, only set when honesty matters (transcodes). */
    detail?: string;
};

/**
 * Turn a probed FileInfo into an honest quality badge. Provenance (not just
 * container format) drives the label — a FLAC container can still wrap lossy
 * audio (yt-dlp's Opus transcode), and the badge must say so rather than
 * repeat the container's own claim.
 */
export function getProvenanceDisplay(fileInfo: FileInfo | undefined): ProvenanceDisplay {
    if (!fileInfo) {
        return { badge: "", tone: "neutral" };
    }

    const format = fileInfo.format.toUpperCase();

    switch (fileInfo.provenance) {
        case "lossless":
            return { badge: format, tone: "success" };
        case "lossy-transcode": {
            // fileInfo.codec is the probed *container's* codec (e.g. "flac" — the
            // re-encode is real) and would be misleading here; sourceCodec is the
            // known original lossy codec upstream, supplied by the downloading
            // service since it isn't recoverable by probing the file itself.
            return {
                badge: `${format}*`,
                tone: "warning",
                detail: fileInfo.sourceCodec
                    ? `${format} (transcoded from ${fileInfo.sourceCodec})`
                    : `${format} (transcoded, not a true lossless source)`,
            };
        }
        case "lossy": {
            const bitrateLabel = fileInfo.bitrateKbps ? `${format} ${fileInfo.bitrateKbps}` : format;
            return { badge: bitrateLabel, tone: "neutral" };
        }
        default:
            return { badge: format, tone: "neutral" };
    }
}
