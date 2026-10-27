import { Logger } from "#base/logger/logger";
import { ProviderDisplay, providerDisplayRegistry } from "#base/providerDisplay";
import { ProviderConsent, ProviderSettingsSchema } from "#base/providerSettings";
import { StatusType } from "#base/task/task-status";
import { Cached } from "#utils/cache";
import type { TrackMetadata, DiscoveryResult, SearchKey } from "#flows/musicDownloadFlow/types";
import { DiscoveryContext, DiscoveryMetadataService } from "#flows/musicDownloadFlow/discoveryMetadataService";
import { DownloadTask } from "#flows/musicDownloadFlow/utils/downloadTask";
import { getMusicSettings } from "#flows/musicDownloadFlow/settings";
import {
    ClaudeClient,
    ClaudeCliError,
    CLAUDE_MODELS,
    DEFAULT_CLAUDE_COMMAND,
    DEFAULT_CLAUDE_MODEL,
} from "../../apis/claude-client";
import { ClaudeLink, claudeLinksToTracks } from "./convertClaudeToTrack";
import {
    CLAUDE_DISCOVERY_SYSTEM_PROMPT,
    ClaudeTrackQuery,
    buildClaudeDiscoveryPrompt,
    buildClaudeDiscoverySchema,
} from "./claudePrompt";
import { ClaudeCell } from "./ClaudeCell";

const PROVIDER_KEY = "claude";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Last-resort discovery: asks Claude (through the user's own Claude Code CLI, i.e. their own plan and
 * quota) to find the track on the platforms nothing else could. Slow (~30s, web research) and it
 * spends quota, so it only runs when the regular discovery services left a gap, and only once the
 * user has allowed it.
 *
 * Claude only proposes URLs. Each one is parsed by the app's own URL parsers and then fetched through
 * the platform's real metadata service by the pipeline, so a hallucinated link fails there instead of
 * being trusted. Results are attributed to "claude" via `fetchedBy` → `discoveredBy`.
 */
export class ClaudeDiscoveryService extends DiscoveryMetadataService {
    static readonly display: ProviderDisplay = {
        label: "Claude",
        acronym: "CLAUDE",
        color: "#d97757",
        colorSubtle: "#6b3a2a",
        colorBright: "#e8957a",
    };
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable (uses your Claude plan)", defaultValue: false, kind: "checkbox" },
        model: { label: "Model", defaultValue: DEFAULT_CLAUDE_MODEL, kind: "select", options: CLAUDE_MODELS },
        command: { label: "Claude CLI command", defaultValue: DEFAULT_CLAUDE_COMMAND, kind: "textInput" },
    };
    static readonly consent: ProviderConsent = {
        title: "Let Claude help find tracks?",
        message:
            "When the other sources can't find a track, Goblin Malin can ask Claude to look it up on the web.\n\n" +
            "It runs the Claude Code CLI installed on this computer, with your own Claude account: each lookup " +
            "takes about 30 seconds and uses part of your plan's usage. The track's title and artists are sent " +
            "to Claude.\n\nChange this anytime in Settings.",
    };
    static readonly lastResort = true;
    static readonly cellComponent = ClaudeCell;

    private client = new ClaudeClient();

    constructor(task: DownloadTask, logger: Logger) {
        super("ClaudeDiscoveryService", task, logger);
    }

    async discoverFromUri(sourceMetadata: TrackMetadata, context?: DiscoveryContext): Promise<DiscoveryResult> {
        const trackName = sourceMetadata.trackName?.trim();
        const wanted = context?.wantedPlatforms ?? [];
        // Nothing to search with (e.g. a URL-only stub), or nothing missing: not worth a Claude call.
        if (!trackName || wanted.length === 0) return { tracks: [] };

        const settings = getMusicSettings().metadata.discoveryProviders[PROVIDER_KEY] ?? {};
        const model = typeof settings.model === "string" && settings.model ? settings.model : DEFAULT_CLAUDE_MODEL;

        const query: ClaudeTrackQuery = {
            trackName,
            artists: sourceMetadata.artists.map((a) => a.name).filter(Boolean),
            album: sourceMetadata.album?.albumName,
            releaseDate: sourceMetadata.album?.releaseDate,
            isrc: sourceMetadata.isrc,
            durationMs: sourceMetadata.duration,
            sourcePlatform: sourceMetadata.platform,
            sourceUrl: sourceMetadata.url,
            wanted,
            model,
        };

        const links = await this.lookup(query);
        const tracks = claudeLinksToTracks(links, wanted);

        const searchKeys: SearchKey[] = [query.isrc ? "trackName+artistName+isrc" : "trackName+artistName"];
        return {
            tracks,
            searchKeys,
            anchor: { state: tracks.length > 0 ? "found" : "notFound", count: tracks.length },
        };
    }

    // Cached on the plain query (title/artists/ISRC/wanted/model) rather than the source metadata
    // object, whose fetch timestamp would make every refetch a cache miss — this call is expensive.
    // Short TTL (vs the 90-day default): a "nothing found" shouldn't stick for months.
    @Cached({ ttl: CACHE_TTL_MS })
    private async lookup(query: ClaudeTrackQuery): Promise<ClaudeLink[]> {
        const settings = getMusicSettings().metadata.discoveryProviders[PROVIDER_KEY] ?? {};
        const command = typeof settings.command === "string" ? settings.command : DEFAULT_CLAUDE_COMMAND;
        const label = `"${query.trackName}" by ${query.artists.join(", ")}`;
        this.logger.info(`Asking Claude (${query.model}) to find ${label} on: ${query.wanted.join(", ")}`);
        this.status.set({
            type: StatusType.Processing,
            message: "Asking Claude",
            timeTracking: true,
            icon: "agent",
            iconColor: providerDisplayRegistry.get(PROVIDER_KEY).color,
        });

        try {
            const { data } = await this.client.run<{ links?: ClaudeLink[] }>({
                prompt: buildClaudeDiscoveryPrompt(query),
                systemPrompt: CLAUDE_DISCOVERY_SYSTEM_PROMPT,
                model: query.model,
                jsonSchema: buildClaudeDiscoverySchema(query.wanted),
                tools: ["WebSearch", "WebFetch"],
                command,
            });
            const links = Array.isArray(data.links) ? data.links : [];
            this.logger.info(
                `Claude proposed ${links.length} link(s) for ${label}: ` +
                    links
                        .map((l) => `${l.platform} ${l.url} (${l.confidence}${l.evidence ? `, ${l.evidence}` : ""})`)
                        .join(" | ")
            );
            this.status.clear();
            return links;
        } catch (error) {
            this.logger.error(`Error asking Claude about ${label}`, { error });
            this.status.set({ type: StatusType.Error, message: describeFailure(error) });
            throw error;
        }
    }
}

function describeFailure(error: unknown): string {
    if (!(error instanceof ClaudeCliError)) return "Error asking Claude";
    switch (error.code) {
        case "not-installed":
            return "Claude CLI not found";
        case "not-logged-in":
            return "Claude CLI not logged in";
        case "quota":
            return "Claude usage limit reached";
        case "timeout":
            return "Claude timed out";
        default:
            return "Error asking Claude";
    }
}
