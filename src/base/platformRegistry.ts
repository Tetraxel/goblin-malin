import { type ParsedUrl } from "./urlParser";

/**
 * What the registered services say about the platforms they handle, so core code never has to
 * branch on a platform key. `ServiceRegistry.register()` fills it from optional static
 * capabilities of the service class:
 *
 * - `platformAliases` — other platform keys whose tracks this service handles (YouTube Music
 *   links are YouTube videos: `youtubeMusic` is an alias of `youtube`).
 * - `trackUrl(id)` — the canonical URL of a track on the service's own platform.
 * - `openUri(parsed)` — the address that opens one of its links in the platform's desktop app.
 */
class PlatformRegistry {
    private aliases = new Map<string, string>();
    private trackUrls = new Map<string, (id: string) => string>();
    private openUris = new Map<string, (parsed: ParsedUrl) => string | undefined>();

    registerAliases(canonical: string, aliases: readonly string[]): void {
        for (const alias of aliases) this.aliases.set(alias, canonical);
    }

    registerTrackUrl(platform: string, trackUrl: (id: string) => string): void {
        this.trackUrls.set(platform, trackUrl);
    }

    registerOpenUri(platform: string, openUri: (parsed: ParsedUrl) => string | undefined): void {
        this.openUris.set(platform, openUri);
    }

    /** The platform key a service is registered under for `platform` (itself unless it is an alias). */
    canonical(platform: string): string {
        return this.aliases.get(platform) ?? platform;
    }

    /** Canonical URL of a track, or `undefined` when its platform's service did not declare one. */
    trackUrl(platform: string, id: string): string | undefined {
        return this.trackUrls.get(this.canonical(platform))?.(id);
    }

    /** The desktop-app address of a link the platform's service read, or `undefined` when it declared none. */
    openUri(parsed: ParsedUrl): string | undefined {
        return this.openUris.get(this.canonical(parsed.platform))?.(parsed);
    }
}

export const platformRegistry = new PlatformRegistry();
