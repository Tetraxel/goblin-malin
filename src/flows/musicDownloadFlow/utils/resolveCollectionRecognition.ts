import { ServiceRegistry } from "#base/service-registry";
import { MetadataService } from "../metadataService";
import type { DownloadTask } from "./downloadTask";

export type CollectionRecognition = {
    serviceKey: string; // registry key that recognized the URL & will expand it (e.g. "spotify")
    collectionKind: "album" | "playlist";
    sourceId?: string; // platform-specific collection id, when parseUrl provided one
};

// Resolve a URL against the registered metadata services' parseUrl exactly once,
// matching album/playlist types. Mirrors resolveTrackRecognition.ts — purely
// regex/URL-shape based, no network call. Independent of whether the recognizing
// service actually implements expandCollection; that's checked later, when the
// resulting CollectionTask is started (an unrecognized-but-parsed collection
// surfaces as a normal task error rather than silently falling back to "Unknown").
export function resolveCollectionRecognition(
    url: string,
    registry: ServiceRegistry<DownloadTask, MetadataService>
): CollectionRecognition | null {
    for (const [serviceKey, ctor] of registry.getAllConstructors()) {
        const parsed = ctor.parseUrl?.(url);
        if (parsed?.type === "album" || parsed?.type === "playlist") {
            return { serviceKey, collectionKind: parsed.type, sourceId: parsed.id };
        }
    }
    return null;
}
