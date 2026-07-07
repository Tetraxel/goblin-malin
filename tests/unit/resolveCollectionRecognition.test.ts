import { describe, test, expect } from "vitest";
import { ServiceRegistry } from "#base/service-registry";
import { MetadataService } from "#flows/musicDownloadFlow/metadataService";
import type { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { resolveCollectionRecognition } from "#flows/musicDownloadFlow/utils/resolveCollectionRecognition";
import { ParsedUrl } from "#base/urlParser";

// Minimal fixture services — registering a class (rather than a factory function)
// is what populates ServiceRegistry.getAllConstructors(), which
// resolveCollectionRecognition walks. Never instantiated, so the abstract methods
// just need to satisfy the type checker.
class FakeSpotify extends MetadataService {
    static override parseUrl(url: string): ParsedUrl | null {
        const m = url.match(/open\.spotify\.com\/(album|playlist|track)\/([a-zA-Z0-9]+)/);
        if (!m) return null;
        return { platform: "spotify", type: m[1] as ParsedUrl["type"], id: m[2] };
    }
    async getTrackMetadata(): Promise<never> {
        throw new Error("not implemented");
    }
    async searchTrack(): Promise<never> {
        throw new Error("not implemented");
    }
}

class FakeYoutube extends MetadataService {
    static override parseUrl(url: string): ParsedUrl | null {
        if (!url.includes("youtube.com/playlist")) return null;
        const id = new URL(url).searchParams.get("list");
        return id ? { platform: "youtube", type: "playlist", id } : null;
    }
    async getTrackMetadata(): Promise<never> {
        throw new Error("not implemented");
    }
    async searchTrack(): Promise<never> {
        throw new Error("not implemented");
    }
}

function buildRegistry(): ServiceRegistry<DownloadTask, MetadataService> {
    const registry = new ServiceRegistry<DownloadTask, MetadataService>();
    registry.register("spotify", FakeSpotify);
    registry.register("youtube", FakeYoutube);
    return registry;
}

describe("resolveCollectionRecognition", () => {
    test("recognizes a Spotify playlist URL", () => {
        const result = resolveCollectionRecognition("https://open.spotify.com/playlist/abc123", buildRegistry());
        expect(result).toEqual({ serviceKey: "spotify", collectionKind: "playlist", sourceId: "abc123" });
    });

    test("recognizes a Spotify album URL", () => {
        const result = resolveCollectionRecognition("https://open.spotify.com/album/xyz789", buildRegistry());
        expect(result).toEqual({ serviceKey: "spotify", collectionKind: "album", sourceId: "xyz789" });
    });

    test("recognizes a YouTube Music playlist URL", () => {
        const result = resolveCollectionRecognition(
            "https://music.youtube.com/playlist?list=PL123",
            buildRegistry()
        );
        expect(result).toEqual({ serviceKey: "youtube", collectionKind: "playlist", sourceId: "PL123" });
    });

    test("returns null for a track URL (not a collection)", () => {
        expect(resolveCollectionRecognition("https://open.spotify.com/track/abc123", buildRegistry())).toBeNull();
    });

    test("returns null for a URL no service recognizes", () => {
        expect(resolveCollectionRecognition("https://example.com/whatever", buildRegistry())).toBeNull();
    });
});
