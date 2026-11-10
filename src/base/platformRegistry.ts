/**
 * What the registered services say about the platforms they handle, so core code never has to
 * branch on a platform key. `ServiceRegistry.register()` fills it from two optional static
 * capabilities of the service class:
 *
 * - `platformAliases` — other platform keys whose tracks this service handles (YouTube Music
 *   links are YouTube videos: `youtubeMusic` is an alias of `youtube`).
 * - `trackUrl(id)` — the canonical URL of a track on the service's own platform.
 */
class PlatformRegistry {
    private aliases = new Map<string, string>();
    private trackUrls = new Map<string, (id: string) => string>();

    registerAliases(canonical: string, aliases: readonly string[]): void {
        for (const alias of aliases) this.aliases.set(alias, canonical);
    }

    registerTrackUrl(platform: string, trackUrl: (id: string) => string): void {
        this.trackUrls.set(platform, trackUrl);
    }

    /** The platform key a service is registered under for `platform` (itself unless it is an alias). */
    canonical(platform: string): string {
        return this.aliases.get(platform) ?? platform;
    }

    /** Canonical URL of a track, or `undefined` when its platform's service did not declare one. */
    trackUrl(platform: string, id: string): string | undefined {
        return this.trackUrls.get(this.canonical(platform))?.(id);
    }
}

export const platformRegistry = new PlatformRegistry();
