import { type FileInfo, type SavedFile } from "#flows/musicDownloadFlow/types";
import { OUTPUT_FORMATS, parseOutputFormat } from "./outputFormat";

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
 * The badge of a track's saved file. Usually that is the download's own (`getProvenanceDisplay`); when saving
 * re-encoded it (`converted`), the download no longer describes the file, so the badge is worked out from the
 * format it was converted to: a lossless target holding a lossy source is a transcode, a lossy target is
 * labelled with its nominal bitrate.
 */
export function getSavedFileDisplay(
    fileInfo: FileInfo | undefined,
    converted?: SavedFile["converted"]
): ProvenanceDisplay {
    const target = converted ? OUTPUT_FORMATS[parseOutputFormat(converted.format)] : undefined;
    if (!converted || !target || target.ext !== converted.format) return getProvenanceDisplay(fileInfo);

    const label = converted.format.toUpperCase();
    // What the file was before: the codec the service knows it came from, else its format (with the real bitrate).
    const from = fileInfo
        ? (fileInfo.sourceCodec ??
          (fileInfo.bitrateKbps && fileInfo.provenance === "lossy"
              ? `${fileInfo.format.toUpperCase()} ${fileInfo.bitrateKbps}`
              : fileInfo.format.toUpperCase()))
        : undefined;
    if (!target.lossless) {
        return {
            badge: `${label} ${target.kbps}`,
            tone: "neutral",
            ...(from ? { detail: `${label} (converted from ${from})` } : {}),
        };
    }
    if (fileInfo && fileInfo.provenance !== "lossless") {
        return { badge: `${label}*`, tone: "warning", detail: `${label} (transcoded from ${from})` };
    }
    return { badge: label, tone: "success" };
}

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
