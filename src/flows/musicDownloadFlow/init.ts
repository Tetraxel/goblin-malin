import { globalLogger } from "#base/logger/logger";
import { SettingsStore } from "#settings/settingsStore";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { applyStageConcurrency } from "./utils/stageLimiters";
import { liveRefreshScheduler } from "./utils/liveRefreshScheduler";
import { metadataServiceRegistry, discoveryServiceRegistry, downloadServiceRegistry } from "./registries";
import { SpotifyService } from "./services/metadata-providers/spotify/SpotifyService";
import { YoutubeService } from "./services/metadata-providers/youtube/YoutubeService";
import { SonglinkService } from "./services/metadata-providers/songlink/SonglinkService";
import { MusicBrainzDiscoveryService } from "./services/metadata-providers/musicbrainz/MusicBrainzDiscoveryService";
import { YtDlpService } from "./services/download-providers/ytdlp/YtDlpService";
import { SoulseekService } from "./services/download-providers/soulseek/SoulseekService";

let initialized = false;

/**
 * One-time app bootstrap, called explicitly from the entry point (index.tsx)
 * before the first render. Registers all providers and applies the user's
 * concurrency budgets (re-applied on every settings change).
 */
export function initMusicApp(): void {
    if (initialized) return;
    initialized = true;

    globalLogger.debug("Initializing music downloader");

    // Register all available providers. Add new providers here.
    metadataServiceRegistry.register("spotify", SpotifyService);
    metadataServiceRegistry.register("youtube", YoutubeService);
    // metadataServiceRegistry.register('musicbrainz', MusicBrainzService);

    discoveryServiceRegistry.register("songlink", SonglinkService);
    discoveryServiceRegistry.register("musicBrainz", MusicBrainzDiscoveryService);

    downloadServiceRegistry.register("ytdlp", YtDlpService);
    downloadServiceRegistry.register("soulseek", SoulseekService);

    applyConcurrencySettings();
    SettingsStore.getInstance().onSettingsChanged(applyConcurrencySettings);

    liveRefreshScheduler.start();
}

/** Push the user's concurrency budgets into the orchestrator + stage limiters. */
function applyConcurrencySettings(): void {
    const { maxParallelTasks, maxParallelMetadata, maxParallelDownloads } =
        SettingsStore.getInstance().getAppSettings().general.concurrency;
    TaskOrchestrator.getInstance().setGlobalMaxConcurrent(maxParallelTasks);
    applyStageConcurrency(maxParallelMetadata, maxParallelDownloads);
}
