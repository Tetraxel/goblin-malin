import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { TrackMetadata } from "#flows/musicDownloadFlow/types";

function formatDurationMs(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}-${String(seconds).padStart(2, "0")}`;
}

function getTempFilePrefix(providerLabel: string, metadata: TrackMetadata): string {
    if (metadata.uri) {
        const uriSlug = metadata.uri.replace(/::/g, "-");
        return `${providerLabel} ${uriSlug}`;
    }
    const artist = metadata.artists?.[0]?.name ?? "Unknown Artist";
    const duration = metadata.duration != null ? ` ${formatDurationMs(metadata.duration)}` : "";
    return `${providerLabel} ${metadata.trackName} - ${artist}${duration}`;
}

export function generateTempFilename(providerLabel: string, metadata: TrackMetadata, format: string): string {
    const prefix = getTempFilePrefix(providerLabel, metadata);
    return `${prefix} ${randomUUID()}.${format}`;
}

export function findExistingTempFile(
    providerLabel: string,
    metadata: TrackMetadata,
    format: string,
    dir: string
): string | undefined {
    if (!metadata.uri || !fs.existsSync(dir)) return undefined;
    const prefix = getTempFilePrefix(providerLabel, metadata);
    const match = fs.readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(`.${format}`));
    return match ? path.join(dir, match) : undefined;
}
