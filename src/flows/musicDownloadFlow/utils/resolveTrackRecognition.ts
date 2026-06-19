import { ServiceRegistry } from "#base/service-registry";
import { MetadataService } from "../metadataService";
import { Platform, TrackUriParts } from "../types";
import type { DownloadTask } from "./downloadTask";

export type TrackRecognition = {
    serviceKey: string; // registry key that recognized the URL & will fetch it (e.g. "youtube")
    uri: TrackUriParts;
};

// Resolve a URL against the registered metadata services exactly once, calling each
// service's static parseUrl directly. Returns the recognizing service key and the
// structured URI, or null when no service recognizes the URL as a fetchable track.
// Single source of truth for "URL → recognition" — used both at task creation and
// when fetching primary metadata.
export function resolveTrackRecognition(
    url: string,
    registry: ServiceRegistry<DownloadTask, MetadataService>
): TrackRecognition | null {
    for (const [serviceKey, ctor] of registry.getAllConstructors()) {
        const parsed = ctor.parseUrl?.(url);
        if (parsed?.type === "track" && parsed.id) {
            return {
                serviceKey,
                uri: { platform: parsed.platform as Platform, type: "track", id: parsed.id },
            };
        }
    }
    return null;
}
