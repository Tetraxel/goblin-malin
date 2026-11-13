import fs from "fs/promises";
import { Task } from "#base/task/task";
import { TaskOrchestrator } from "#base/task/orchestrator";
import { TaskScoped } from "#base/task/taskContext";
import { globalLogger, type Logger } from "#base/logger/logger";
import { type ServiceRegistry } from "#base/service-registry";
import { type ServiceScope } from "#base/service-scope";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { platformRegistry } from "#base/platformRegistry";
import { urlParserRegistry } from "#base/urlParser";
import { type StatusAttributes, StatusType } from "#base/task/task-status";
import { throwIfAborted } from "#utils/errors";
import {
    type TrackDownloadTask,
    type TrackMetadata,
    type TrackDownloadSource,
    type MetadataGroupState,
    type MetadataResultState,
    type DiscoverySource,
    type UserSource,
    type TrackUriParts,
    type DiscoveryResult,
    type Platform,
    type LocalFile,
} from "#flows/musicDownloadFlow/types";
import { runWithoutCache, isCacheSkipped } from "#utils/cache";
import { overwriteConfirmBridge } from "#base/bridges/overwriteConfirmBridge";
import { SafeAction } from "#utils/decorators";
import { metadataLimiter, downloadLimiter } from "./stageLimiters";
import { computeConfidenceScore } from "./confidence";
import { resolveTrackRecognition } from "./resolveTrackRecognition";
import { formatTrackUri, parseTrackUri } from "./trackUri";
import { ensureDiscoveryConsent, getUnansweredConsentKeys } from "./discoveryConsent";
import { computeCompiledMetadata } from "./compiledMetadata";
import { compiledFieldValues } from "./metadataFields";
import { compiledMetadataToTags } from "./compiledMetadataToTags";
import { computeOutputPath, isOutputPathTaken, samePath } from "./computeOutputPath";
import { convertAudioInto } from "./convertAudio";
import { extensionOf, parseOutputFormat, planSave } from "./outputFormat";
import { isSavedFrom, releaseSavedFile } from "./savedSource";
import { tagAudioFile } from "./tagAudioFile";
import { createSingleFlight } from "./singleFlight";
import { writeViaStaging } from "./writeViaStaging";
import { pickAutoSelectedIndex } from "./sourceSelection";
import { maxDownloadsPerProvider, parseDownloadStrategy, stopsAtFirstDownload } from "./downloadStrategy";
import { type MetadataService } from "../metadataService";
import { type DiscoveryMetadataService } from "../discoveryMetadataService";
import { type DownloadService, type DownloadUpdateOptions } from "../downloadService";
import { getSaveSettings } from "../saveSettings";
import { getMusicSettings } from "../settings";
import { MusicBrainzClient } from "../services/apis/musicbrainz-client";
import { checkMusicBrainzIdentity, unknownIdentity, type IdentityCheckOptions } from "../musicbrainz/identityCheck";
import { type MbUserChoice, type MusicBrainzIdentity, type ProviderAlbum } from "../musicbrainz/types";
import { isMusicBrainzVerdictStale, musicBrainzInputKey } from "../musicbrainz/inputKey";
import { normalizeUrl } from "../musicbrainz/normalize";

// The @Cached() decorator persists results to a 90-day disk cache. Old cache entries
// may still contain a plain TrackMetadata[] (the previous return format). Normalizing
// at call sites lets us handle both formats without clearing user caches.
function normalizeDiscoveryResult(raw: unknown): DiscoveryResult {
    if (Array.isArray(raw)) return { tracks: raw as TrackMetadata[] };
    return raw as DiscoveryResult;
}

// A last-resort service (an AI guessing links) only gets a result into the list if, once the platform
// has returned the real metadata, it scores at least this well against the primary track (0–100).
// Title alone is worth 40, so a same-title cover by someone else does not pass.
const LAST_RESORT_MIN_CONFIDENCE = 50;

// Handle on the discovery stage currently running, so the user can cut it short.
interface DiscoveryRun {
    skipped: boolean;
    skip: () => void;
}

/** `DownloadTask.checkMusicBrainz` options: the lookups' own, plus a way to change the user's decisions safely. */
export type MusicBrainzCheckOptions = IdentityCheckOptions & {
    /** Receives the user's decisions as they are when this check runs (never an older copy) and returns the new ones. */
    decide?: (current: MbUserChoice) => MbUserChoice;
};

/** What `DownloadTask.addUserSources` did with the links it was given. */
export type AddUserSourcesResult = {
    added: UserSource[];
    skipped: { url: string; reason: string }[];
};

export class DownloadTask extends Task<TrackDownloadTask> {
    private discoveryRun?: DiscoveryRun;
    /** The MusicBrainz checks of this track, one after the other (see `checkMusicBrainz`). */
    private musicBrainzQueue: Promise<unknown> = Promise.resolve();
    private metadataServices: ServiceScope<DownloadTask, MetadataService>;
    private discoveryServices: ServiceScope<DownloadTask, DiscoveryMetadataService>;
    private downloadServices: ServiceScope<DownloadTask, DownloadService>;
    private metadataServiceRegistry: ServiceRegistry<DownloadTask, MetadataService>;
    private discoveryServiceRegistry: ServiceRegistry<DownloadTask, DiscoveryMetadataService>;
    private isMetadataServiceEnabled: (key: string) => boolean;
    private isDiscoveryServiceEnabled: (key: string) => boolean;
    private isDownloadServiceEnabled: (key: string) => boolean;
    // Download providers whose search + download is being re-run by the user right now.
    private retryingProviders = new Set<string>();
    // Cancel handle for whichever download source row is currently in flight, keyed
    // by its index in `downloadSources` — populated from onUpdate's `abort` option
    // (see DownloadUpdateOptions) and consumed by rejectDownloadSource() so rejecting
    // an actively-downloading row actually stops it instead of just hiding it.
    private activeAbortBySourceIndex = new Map<number, () => void>();
    // Held for the whole of `saveTrack`, from before its first await.
    private saveGuard = createSingleFlight();

    constructor({
        id,
        initialInput,
        attributes,
        logger,
        initialStatus,
        metadataServiceRegistry,
        discoveryServiceRegistry,
        downloadServiceRegistry,
        isMetadataServiceEnabled,
        isDiscoveryServiceEnabled,
        isDownloadServiceEnabled,
    }: {
        id: string;
        initialInput?: string;
        attributes?: TrackDownloadTask;
        logger: Logger;
        initialStatus?: StatusAttributes;
        metadataServiceRegistry: ServiceRegistry<DownloadTask, MetadataService>;
        discoveryServiceRegistry: ServiceRegistry<DownloadTask, DiscoveryMetadataService>;
        downloadServiceRegistry: ServiceRegistry<DownloadTask, DownloadService>;
        isMetadataServiceEnabled: (key: string) => boolean;
        isDiscoveryServiceEnabled: (key: string) => boolean;
        isDownloadServiceEnabled: (key: string) => boolean;
    }) {
        super({ id, initialInput, attributes, logger, initialStatus });

        this.metadataServiceRegistry = metadataServiceRegistry;
        this.discoveryServiceRegistry = discoveryServiceRegistry;
        this.isMetadataServiceEnabled = isMetadataServiceEnabled;
        this.isDiscoveryServiceEnabled = isDiscoveryServiceEnabled;
        this.isDownloadServiceEnabled = isDownloadServiceEnabled;
        this.metadataServices = metadataServiceRegistry.createScope(this, this.logger, isMetadataServiceEnabled);
        this.discoveryServices = discoveryServiceRegistry.createScope(this, this.logger, isDiscoveryServiceEnabled);
        this.downloadServices = downloadServiceRegistry.createScope(this, this.logger, isDownloadServiceEnabled);
    }

    // Log-line label: the structured uri when known, else the input URL.
    public override getLogLabel(): string | undefined {
        const uri = this.getAttributes()?.uri;
        if (uri) return `${uri.platform}::${uri.type}::${uri.id}`;
        return this.getAttributes()?.userInput.url ?? this.getInitialInput();
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    private getPrimaryMetadata(): MetadataResultState | undefined {
        for (const group of this.getAttributes()?.metadataGroups ?? []) {
            const primary = group.results.find((r) => r.isPrimaryInput);
            if (primary) return primary;
        }
        return undefined;
    }

    private addResultToGroup(
        metadata: TrackMetadata,
        serviceKey: string,
        discoverySources: DiscoverySource[],
        isPrimaryInput = false,
        fetchState?: "loading" | "error",
        fetchError?: string
    ): void {
        const groups = [...(this.getAttributes()?.metadataGroups ?? [])];

        let groupIdx = groups.findIndex((g) => g.serviceKey === serviceKey);
        if (groupIdx === -1) {
            groups.push({
                platform: metadata.platform,
                serviceKey,
                rank: groups.length,
                results: [],
            });
            groupIdx = groups.length - 1;
        }

        const group: MetadataGroupState = {
            ...groups[groupIdx],
            results: [...groups[groupIdx].results],
        };

        // Upsert by URI within the group
        const existingIdx = metadata.uri ? group.results.findIndex((r) => r.metadata.uri === metadata.uri) : -1;

        if (existingIdx !== -1) {
            group.results[existingIdx] = {
                ...group.results[existingIdx],
                discoverySources: [...group.results[existingIdx].discoverySources, ...discoverySources],
            };
        } else {
            const primaryMeta = this.getPrimaryMetadata()?.metadata;
            const confidence =
                isPrimaryInput || !primaryMeta ? undefined : computeConfidenceScore(metadata, primaryMeta);

            const newResult: MetadataResultState = {
                metadata,
                isPrimaryInput,
                isFavorited: false,
                isRejected: false,
                rank: group.results.length,
                confidence,
                discoverySources,
                fetchState,
                fetchError,
            };
            group.results.push(newResult);
        }

        groups[groupIdx] = group;
        this.updateAttributes({ metadataGroups: groups });
    }

    private updateResultInGroup(groupIndex: number, resultIndex: number, patch: Partial<MetadataResultState>): void {
        const groups = [...(this.getAttributes()?.metadataGroups ?? [])];
        const group = groups[groupIndex];
        if (!group) return;
        const results = [...group.results];
        if (!results[resultIndex]) return;
        results[resultIndex] = { ...results[resultIndex], ...patch };
        groups[groupIndex] = { ...group, results };
        this.updateAttributes({ metadataGroups: groups });
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @TaskScoped()
    @SafeAction("Start task")
    async start(signal?: AbortSignal): Promise<void> {
        try {
            const state = this.getAttributes()?.state;
            if (state !== "pending" && state !== "stopped") {
                this.logger.info(`Skipping because task already processed ${this.getInitialInput()}`);
                return;
            }

            // Clean up partial state from a previous stopped run
            if (state === "stopped") {
                this.updateAttributes({
                    state: "pending",
                    metadataGroups: [],
                    metadataOverride: {},
                    downloadSources: [],
                    primaryMetadataFetched: false,
                    metadataDiscovered: false,
                    downloadsFetched: false,
                });
                this.status.clear();
            }

            this.logger.info(`Starting to process ${this.getInitialInput()}`);
            this.updateAttributes({ state: "running" });

            throwIfAborted(signal);

            if (this.getAttributes()?.toTag) {
                // Gate the metadata stage behind the shared metadata budget so many
                // in-flight tasks don't fan out into as many concurrent API calls.
                await metadataLimiter.run(async () => {
                    throwIfAborted(signal);
                    // If primary metadata is not fetched -> fetch it
                    if (!this.getPrimaryMetadata()) {
                        await this.startPrimaryMetadataFetching();
                    }
                    throwIfAborted(signal);
                    await this.startMetadataDiscovering();
                });
            }

            throwIfAborted(signal);

            if (this.getAttributes()?.toDownload) {
                // Gate the download stage behind the shared download budget (concurrent
                // yt-dlp processes) — the lever that scales download parallelism.
                await downloadLimiter.run(() => this.startDownloads(signal));
            }
            this.updateAttributes({ state: "finished" });
        } catch (error) {
            if ((error as Error).name === "AbortError") {
                this.updateAttributes({ state: "stopped" });
                this.status.set({ type: StatusType.Skipped, message: "Stopped" });
                throw error;
            }
            this.updateAttributes({ state: "failed" });
            throw error;
        }
    }

    // ── Primary metadata ──────────────────────────────────────────────────────

    @TaskScoped()
    @SafeAction("Re-fetch primary metadata")
    async startPrimaryMetadataFetching(): Promise<void> {
        const url = this.getAttributes()?.userInput.url;
        if (!url) throw new Error("No user input URL provided");

        this.logger.info(`Fetching primary metadata for URL: ${url}`);

        // Remove previous primary results from all groups.
        // Keep the primary group even when it becomes empty — preserves its rank so addResultToGroup
        // can find it by serviceKey and won't append it at the end with a new rank.
        const currentGroups = this.getAttributes()?.metadataGroups ?? [];
        const primaryGroupKey = currentGroups.find((g) => g.results.some((r) => r.isPrimaryInput))?.serviceKey;
        const nonPrimaryGroups = currentGroups
            .map((g) => ({ ...g, results: g.results.filter((r) => !r.isPrimaryInput) }))
            .filter((g) => g.results.length > 0 || g.serviceKey === primaryGroupKey);

        this.updateAttributes({
            metadataGroups: nonPrimaryGroups,
            primaryMetadataInProgress: true,
            primaryMetadataFetched: false,
        });

        try {
            // Step 1: Recognition was resolved once at import time (resolveTrackRecognition)
            // and stored on the task. A missing recognition means the URL is "Unknown".
            const attrs = this.getAttributes();
            const recognizingServiceKey = attrs?.recognizedServiceKey;
            const recognizedPlatform = attrs?.uri?.platform;

            if (!recognizingServiceKey || !recognizedPlatform) {
                this.status.update({ type: StatusType.Error, message: "Primary metadata unavailable" });
                throw new Error(`No metadata service recognized the URL: ${url}`);
            }

            // Step 2: If the recognizing service is enabled, try fetching
            let fetchedViaService = false;
            if (this.isMetadataServiceEnabled(recognizingServiceKey)) {
                try {
                    const service = this.metadataServices.get(recognizingServiceKey);
                    this.logger.debug(`Fetching primary metadata using ${recognizingServiceKey}`);
                    const metadata = await service.getTrackMetadata(url);
                    this.addResultToGroup(metadata, recognizingServiceKey, [], true);
                    fetchedViaService = true;
                    this.logger.info(`Successfully fetched primary metadata from ${metadata.apiProvider}`);
                } catch (error) {
                    this.logger.warn(`Primary fetch failed for ${recognizingServiceKey}, trying discovery fallback`, {
                        error,
                    });
                }
            }

            // Step 3: If disabled or all enabled services failed → try discovery services
            if (!fetchedViaService) {
                const stubMetadata = {
                    id: "",
                    trackName: "",
                    artists: [],
                    url,
                    platform: recognizedPlatform,
                    apiProvider: recognizedPlatform,
                    fetchedAt: new Date(),
                    type: "track" as const,
                } as unknown as TrackMetadata;

                for (const discoveryService of this.discoveryServices.getAllServices()) {
                    try {
                        const { tracks: discovered } = await discoveryService.discoverFromUri(stubMetadata);
                        const match = discovered.find((m) => m.platform === recognizedPlatform);
                        if (!match) continue;

                        // Add as loading primary result
                        this.addResultToGroup(match, recognizingServiceKey, [], true, "loading");

                        // Attempt enrichment
                        const groups = this.getAttributes()?.metadataGroups ?? [];
                        const gIdx = groups.findIndex((g) => g.serviceKey === recognizingServiceKey);
                        const rIdx = groups[gIdx]?.results.findIndex((r) => r.isPrimaryInput) ?? -1;

                        if (this.isMetadataServiceEnabled(recognizingServiceKey) && match.url) {
                            try {
                                const service = this.metadataServices.get(recognizingServiceKey);
                                const enriched = await service.getTrackMetadata(match.url);
                                if (gIdx >= 0 && rIdx >= 0) {
                                    this.updateResultInGroup(gIdx, rIdx, {
                                        metadata: enriched,
                                        fetchState: undefined,
                                    });
                                }
                            } catch {
                                if (gIdx >= 0 && rIdx >= 0) {
                                    this.updateResultInGroup(gIdx, rIdx, {
                                        fetchState: "error",
                                        fetchError: "Enrichment failed",
                                    });
                                }
                            }
                        } else {
                            if (gIdx >= 0 && rIdx >= 0) {
                                this.updateResultInGroup(gIdx, rIdx, { fetchState: undefined });
                            }
                        }

                        fetchedViaService = true;
                        break;
                    } catch (error) {
                        this.logger.warn(`Discovery fallback failed via ${discoveryService.id}`, { error });
                    }
                }
            }

            if (!this.getPrimaryMetadata()) {
                this.status.update({ type: StatusType.Error, message: "Primary metadata unavailable" });
                throw new Error(`No metadata service could fetch metadata for the URL: ${url}`);
            }
        } finally {
            this.updateAttributes({ primaryMetadataInProgress: false });
        }

        // Refine the log-prefix uri with the authoritative platform + id.
        const primaryMeta = this.getPrimaryMetadata()?.metadata;
        if (primaryMeta?.id) {
            this.updateAttributes({
                uri: { platform: primaryMeta.platform, type: "track", id: primaryMeta.id },
            });
        }

        this.updateAttributes({ primaryMetadataFetched: true });
    }

    // ── Discovery ─────────────────────────────────────────────────────────────

    @TaskScoped()
    @SafeAction("Re-discover metadata providers")
    async startMetadataDiscovering(): Promise<void> {
        const primaryResult = this.getPrimaryMetadata();
        if (!primaryResult) throw new Error("No primary metadata source available for metadata discovering");

        const primaryMetadata = primaryResult.metadata;
        const primaryUri = primaryMetadata.uri ?? primaryMetadata.url;

        this.logger.info(`Discovering metadata from all other sources`);
        this.updateAttributes({
            // Keep all groups and their order, only remove previously discovered (non-primary) results
            metadataGroups: (this.getAttributes()?.metadataGroups ?? []).map((g) => ({
                ...g,
                // The primary input and the links the user added by hand are theirs: only what the search found goes.
                results: g.results.filter((r) => r.isPrimaryInput || r.addedByUser),
            })),
            metadataDiscoveringInProgress: true,
            metadataDiscovered: false,
        });

        // The user can end this stage early with skipDiscovery(). The run stops waiting at once; any
        // request still in flight finishes in the background, and `run.skipped` keeps it from adding to
        // the results afterwards.
        const run: DiscoveryRun = { skipped: false, skip: () => {} };
        const skippedSignal = new Promise<void>((resolve) => {
            run.skip = () => {
                run.skipped = true;
                resolve();
            };
        });
        this.discoveryRun = run;

        const discoverEverywhere = async () => {
            // The user's own links first: they are the most reliable thing this track has, and a platform they
            // cover is no longer "missing" for the last-resort services (no Claude call spent on it).
            await this.applyUserSources();
            if (run.skipped) return;

            // Phase A — MetadataService.searchTrack (like Spotify, Youtube, etc.)
            const services = this.metadataServices.getAllServices();
            for (const service of services) {
                if (run.skipped) return;
                // Skip the service that owns the primary metadata
                if (
                    primaryMetadata.platform === service.id.toLowerCase() ||
                    primaryMetadata.apiProvider === service.id.toLowerCase()
                )
                    continue;

                // Find the registry key for this service
                const serviceKey = this.findServiceKey(service.id);
                if (!serviceKey) continue;

                // Skip primary service by registry key
                const primaryGroup = (this.getAttributes()?.metadataGroups ?? []).find((g) =>
                    g.results.some((r) => r.isPrimaryInput)
                );
                if (primaryGroup && primaryGroup.serviceKey === serviceKey) continue;

                try {
                    this.logger.debug(`Searching for track using ${serviceKey}`);
                    const results = await service.searchTrack(primaryMetadata);
                    if (run.skipped) return;

                    for (const result of results) {
                        this.addResultToGroup(result.metadata, serviceKey, [
                            {
                                discoveredBy: serviceKey,
                                fromUri: primaryUri,
                                searchKeys: result.searchKeys,
                            },
                        ]);
                    }
                    this.logger.info(`Phase A: found ${results.length} result(s) from ${serviceKey}`);
                } catch (error) {
                    this.logger.warn(`Phase A search failed for ${serviceKey}`, { error });
                }
            }

            // Phase B — DiscoveryMetadataService.discoverFromUri (like Songlink).
            // Consent-gated services (Songlink) ask the user before their first use.
            for (const [key, ctor] of this.discoveryServiceRegistry.getAllConstructors()) {
                if (run.skipped) return;
                if (ctor.consent && !ctor.lastResort) await this.awaitDiscoveryConsent(key);
            }
            for (const discoveryService of this.discoveryServices.getAllServices()) {
                if (run.skipped) return;
                if (this.isLastResortService(discoveryService)) continue;
                await this.runDiscoveryService(discoveryService, primaryMetadata, primaryUri, undefined, false, run);
            }

            // Phase C — last-resort services (like Claude): slow and/or costly, so they only run when a
            // platform is still missing after everything above, and only once the user has allowed them.
            for (const [key, ctor] of this.discoveryServiceRegistry.getAllConstructors()) {
                if (run.skipped) return;
                if (!ctor.lastResort) continue;
                const wanted = this.getMissingPlatforms();
                if (wanted.length === 0) break;
                if (!(await this.awaitDiscoveryConsent(key))) continue;
                if (run.skipped) return;
                if (!this.isDiscoveryServiceEnabled(key)) continue;
                await this.runDiscoveryService(
                    this.discoveryServices.get(key),
                    primaryMetadata,
                    primaryUri,
                    wanted,
                    false,
                    run
                );
            }

            // Phase D — which MusicBrainz release is this track on? (P30) Read-only lookups; the verdict is
            // stored on the task and never fails it.
            if (run.skipped) return;
            if (getMusicSettings().musicBrainz.matchTracks) {
                try {
                    await this.checkMusicBrainz({ force: isCacheSkipped() });
                } catch (error) {
                    this.logger.warn("MusicBrainz identity check failed", { error });
                }
            }
        };

        try {
            await Promise.race([discoverEverywhere(), skippedSignal]);
        } finally {
            if (this.discoveryRun === run) this.discoveryRun = undefined;
            this.updateAttributes({ metadataDiscoveringInProgress: false });
        }
        if (run.skipped) this.logger.info("Discovery skipped by the user; keeping the sources found so far");
        this.updateAttributes({ metadataDiscovered: true });
    }

    /** Ends the running discovery stage now and keeps the sources found so far. No-op when none is running. */
    skipDiscovery(): void {
        this.discoveryRun?.skip();
    }

    // Runs one discovery service and merges what it found into the metadata groups.
    // `wantedPlatforms` (last-resort services only) lists the platforms that still have no result.
    private async runDiscoveryService(
        discoveryService: DiscoveryMetadataService,
        primaryMetadata: TrackMetadata,
        primaryUri: string,
        wantedPlatforms?: Platform[],
        bypassCache = false,
        run?: DiscoveryRun
    ): Promise<void> {
        const lastResort = this.isLastResortService(discoveryService);
        try {
            const discover = () => discoveryService.discoverFromUri(primaryMetadata, { wantedPlatforms });
            const {
                tracks: allDiscovered,
                anchor,
                searchKeys,
                explanations,
                summaries,
            } = normalizeDiscoveryResult(await (bypassCache ? runWithoutCache(discover) : discover()));
            if (run?.skipped) return;

            // Store the anchor for Copy/Open contextual actions
            if (anchor) {
                const discoveryKey = this.findDiscoveryServiceKey(discoveryService.id);
                if (discoveryKey) {
                    const currentAnchors = this.getAttributes()?.discoveryAnchors ?? {};
                    this.updateAttributes({
                        discoveryAnchors: { ...currentAnchors, [discoveryKey]: anchor },
                    });
                }
            }

            // Exclude the primary platform — it's already handled
            const discovered = (allDiscovered ?? []).filter((m) => m.platform !== primaryMetadata.platform);

            for (const rudimentary of discovered) {
                if (run?.skipped) return;
                const targetServiceKey = this.findServiceKeyForPlatform(rudimentary.platform);
                if (!targetServiceKey) continue;

                // A DiscoveryMetadataService must tag each result with its own key via fetchedBy.
                if (!rudimentary.fetchedBy) {
                    this.logger.warn(`Discovery result missing fetchedBy from ${discoveryService.id}; skipping`);
                    continue;
                }

                // Check dedup: same URI already in group from Phase A?
                const existingGroup = (this.getAttributes()?.metadataGroups ?? []).find(
                    (g) => g.serviceKey === targetServiceKey
                );
                const existingResult =
                    rudimentary.uri && existingGroup
                        ? existingGroup.results.find((r) => r.metadata.uri === rudimentary.uri)
                        : undefined;

                const discoverySource: DiscoverySource = {
                    // `fetchedBy` is the discovery service's key (e.g. "songlink", "musicBrainz")
                    discoveredBy: rudimentary.fetchedBy,
                    fromUri: primaryUri,
                    searchKeys: searchKeys ?? ["url"],
                    ...(rudimentary.uri && explanations?.[rudimentary.uri]
                        ? { explanation: explanations[rudimentary.uri] }
                        : {}),
                    ...(rudimentary.uri && summaries?.[rudimentary.uri] ? { summary: summaries[rudimentary.uri] } : {}),
                };

                if (existingResult) {
                    // Append discovery source to existing result
                    const gIdx = (this.getAttributes()?.metadataGroups ?? []).findIndex(
                        (g) => g.serviceKey === targetServiceKey
                    );
                    const rIdx =
                        (this.getAttributes()?.metadataGroups ?? [])[gIdx]?.results.findIndex(
                            (r) => r.metadata.uri === rudimentary.uri
                        ) ?? -1;
                    if (gIdx >= 0 && rIdx >= 0) {
                        const current = this.getAttributes()!.metadataGroups[gIdx].results[rIdx];
                        this.updateResultInGroup(gIdx, rIdx, {
                            discoverySources: [...current.discoverySources, discoverySource],
                        });
                    }
                } else {
                    // Try enrichment
                    let finalMetadata = rudimentary;
                    let fetchState: "error" | undefined;
                    let fetchError: string | undefined;
                    let enriched = false;

                    if (this.isMetadataServiceEnabled(targetServiceKey) && rudimentary.url) {
                        try {
                            const service = this.metadataServices.get(targetServiceKey);
                            finalMetadata = await service.getTrackMetadata(rudimentary.url);
                            enriched = true;
                        } catch {
                            fetchState = "error";
                            fetchError = "Enrichment failed";
                            finalMetadata = rudimentary;
                        }
                    }

                    if (run?.skipped) return;

                    // A last-resort service only proposes URLs. Trust none of it: the platform itself must
                    // confirm the link exists, and what it returns must actually look like the primary track.
                    if (lastResort) {
                        const confidence = enriched ? computeConfidenceScore(finalMetadata, primaryMetadata) : 0;
                        if (confidence < LAST_RESORT_MIN_CONFIDENCE) {
                            this.logger.info(
                                `Dropping ${discoveryService.id} result ${rudimentary.url}: ` +
                                    (enriched
                                        ? `only ${confidence}% match with the primary track${
                                              discoverySource.explanation
                                                  ? ` (it said: ${discoverySource.explanation})`
                                                  : ""
                                          }`
                                        : "could not verify it")
                            );
                            continue;
                        }
                    }

                    this.addResultToGroup(
                        finalMetadata,
                        targetServiceKey,
                        [discoverySource],
                        false,
                        fetchState,
                        fetchError
                    );
                }
            }
        } catch (error) {
            this.logger.warn(`Phase B discovery failed for ${discoveryService.id}`, { error });
        }
    }

    // ── MusicBrainz identity (P30) ────────────────────────────────────────────

    /**
     * The whole album, from the metadata service that owns the album's link (Spotify for a Spotify album).
     * Null when no enabled service can tell: the checks then go on with what the track itself carried.
     */
    async fetchAlbumDetails(
        album: { id: string; url: string },
        options?: { withIsrcs?: boolean }
    ): Promise<ProviderAlbum | null> {
        for (const [key, ctor] of this.metadataServiceRegistry.getAllConstructors()) {
            if (!this.isMetadataServiceEnabled(key)) continue;
            let type: string | undefined;
            try {
                type = ctor.parseUrl?.(album.url)?.type;
            } catch {
                continue; // a service that does not parse URLs at all
            }
            if (type !== "album") continue;
            const service = this.metadataServices.get(key);
            if (typeof service.getAlbumDetails !== "function") continue;
            try {
                return await service.getAlbumDetails(album, options);
            } catch (error) {
                this.logger.warn(`Could not read the album from ${key}`, { error });
                return null;
            }
        }
        return null;
    }

    /**
     * Works out which MusicBrainz release this track is on and stores the verdict (`musicBrainzIdentity`).
     * `force` asks MusicBrainz again instead of reusing answers; `knownReleaseId` is a release the user just added
     * in the editor; `decide` turns the user's stored decisions into the new ones (it sees the latest, see below);
     * `user` replaces them outright. Returns the new identity.
     *
     * Checks of one track run one after the other. Each takes minutes of rate-limited requests, and each writes the
     * whole verdict: run side by side, the older one finishing last would overwrite what the user decided meanwhile.
     */
    @TaskScoped()
    @SafeAction("Check MusicBrainz")
    checkMusicBrainz(options: MusicBrainzCheckOptions = {}): Promise<MusicBrainzIdentity | undefined> {
        const run = this.musicBrainzQueue.then(() => this.runMusicBrainzCheck(options));
        this.musicBrainzQueue = run.catch(() => undefined);
        return run;
    }

    private async runMusicBrainzCheck(options: MusicBrainzCheckOptions): Promise<MusicBrainzIdentity | undefined> {
        const attrs = this.getAttributes();
        if (!attrs) return undefined;
        const previous = attrs.musicBrainzIdentity;
        // The user's decisions as they are NOW (this run waited its turn), changed by this run's decision if it has one.
        const stored = options.decide
            ? options.decide(previous?.userChoice ?? { rejectedReleaseIds: [], artistChoices: {} })
            : (options.user ?? previous?.userChoice);
        const compiled = computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride);
        const album = compiled.album;

        let identity: MusicBrainzIdentity;
        if (!album || !compiled.trackName) {
            identity = unknownIdentity("No album information from the metadata sources yet", previous);
            if (stored) identity.userChoice = stored;
        } else {
            // A release the user picked or turned down was about ANOTHER album if the sources have changed since:
            // it is kept, but not applied here.
            const albumKey = normalizeUrl(album.url);
            const appliesHere = !stored?.albumKey || stored.albumKey === albumKey;
            const effective =
                stored && !appliesHere ? { ...stored, chosenRelease: undefined, rejectedReleaseIds: [] } : stored;
            const details = await this.fetchAlbumDetails({ id: album.id, url: album.url });
            const providerAlbum: ProviderAlbum = details ?? {
                id: album.id,
                name: album.albumName,
                url: album.url,
                albumType: album.albumType,
                releaseDate: album.releaseDate,
                barcode: album.barcode,
                trackCount: album.totalTracks,
                artists: (album.artists ?? []).map((a) => ({ name: a.name, url: a.url })),
                tracks: [],
            };
            identity = await checkMusicBrainzIdentity(
                new MusicBrainzClient(),
                providerAlbum,
                {
                    name: compiled.trackName,
                    isrc: compiled.isrc,
                    artists: compiled.artists.map((a) => ({ name: a.name, url: a.url })),
                },
                { force: options.force, knownReleaseId: options.knownReleaseId, user: effective }
            );
            if (stored) identity.userChoice = stored;
        }

        // What this verdict was made from, so the UI can say when the sources have changed since.
        identity.inputKey = musicBrainzInputKey(compiled);
        // The hand-off to MusicBrainz is a fact about the user's session, not about the verdict.
        if (previous?.handedOffAt && identity.verdict !== "matched") identity.handedOffAt = previous.handedOffAt;
        this.updateAttributes({ musicBrainzIdentity: identity });
        this.logger.info(`MusicBrainz: ${identity.verdict}${identity.release ? ` (${identity.release.id})` : ""}`);
        return identity;
    }

    private isLastResortService(service: DiscoveryMetadataService): boolean {
        const key = this.findDiscoveryServiceKey(service.id);
        return key ? this.discoveryServiceRegistry.getConstructor(key)?.lastResort === true : false;
    }

    // Platforms whose metadata service is enabled but which still have no result for this track.
    private getMissingPlatforms(): Platform[] {
        const groups = this.getAttributes()?.metadataGroups ?? [];
        const missing: Platform[] = [];
        for (const key of this.metadataServiceRegistry.getAllConstructors().keys()) {
            if (!this.isMetadataServiceEnabled(key)) continue;
            const group = groups.find((g) => g.serviceKey === key);
            if (!group || group.results.length === 0) missing.push(key as Platform);
        }
        return missing.sort();
    }

    // Resolves whether the user lets this discovery service run. The first time, that means showing
    // them a dialog; the task shows "waiting for you" meanwhile instead of looking stuck.
    private async awaitDiscoveryConsent(key: string): Promise<boolean> {
        const mustAsk = getUnansweredConsentKeys().includes(key);
        if (mustAsk) {
            const label = providerDisplayRegistry.get(key).label;
            this.status.set({ type: StatusType.PendingUserAction, message: `Waiting for your answer: ${label}` });
        }
        try {
            return await ensureDiscoveryConsent(key);
        } finally {
            if (mustAsk) this.status.clear();
        }
    }

    // Find registry key by matching service instance id (service.id = constructor name)
    private findServiceKey(serviceId: string): string | undefined {
        for (const [key] of this.metadataServiceRegistry.getAllConstructors()) {
            const service = this.metadataServices.get(key);
            if (service.id === serviceId) return key;
        }
        return undefined;
    }

    // Find registry key whose service handles the given platform
    private findServiceKeyForPlatform(platform: string): string | undefined {
        // A service can declare alias platforms (`platformAliases`), e.g. youtubeMusic → youtube.
        const canonical = platformRegistry.canonical(platform);
        for (const [key] of this.metadataServiceRegistry.getAllConstructors()) {
            if (key === canonical) return key;
        }
        return undefined;
    }

    // Find discovery registry key by matching service instance id (service.id = constructor name)
    private findDiscoveryServiceKey(serviceId: string): string | undefined {
        for (const [key] of this.discoveryServiceRegistry.getAllConstructors()) {
            const service = this.discoveryServices.get(key);
            if (service.id === serviceId) return key;
        }
        return undefined;
    }

    // ── Re-search / Re-fetch ─────────────────────────────────────────────────

    @TaskScoped()
    async startSingleProviderSearch(serviceKey: string): Promise<void> {
        const primaryMetadata = this.getPrimaryMetadata()?.metadata;
        if (!primaryMetadata) {
            this.logger.warn("No primary metadata available for re-search");
            return;
        }
        const primaryUri = primaryMetadata.uri ?? primaryMetadata.url;
        try {
            const service = this.metadataServices.get(serviceKey);
            const results = await service.searchTrack(primaryMetadata!);
            for (const result of results) {
                this.addResultToGroup(result.metadata, serviceKey, [
                    { discoveredBy: serviceKey, fromUri: primaryUri, searchKeys: result.searchKeys },
                ]);
            }
            this.logger.info(`Re-search completed for ${serviceKey}`);
        } catch (error) {
            this.logger.warn(
                `Failed to re-search ${serviceKey}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    @TaskScoped()
    async startSingleProviderDiscovery(serviceKey: string): Promise<void> {
        const primaryMetadata = this.getPrimaryMetadata()?.metadata;
        if (!primaryMetadata) {
            this.logger.warn("No primary metadata available for re-discovery");
            return;
        }
        const primaryUri = primaryMetadata.uri ?? primaryMetadata.url;
        try {
            // Even an explicit [S] still needs the user's OK the first time for a consent-gated service.
            if (!(await this.awaitDiscoveryConsent(serviceKey))) {
                this.logger.info(`Re-discovery skipped for ${serviceKey}: not allowed by the user`);
                return;
            }
            const service = this.discoveryServices.get(serviceKey);
            // A last-resort service is told what to look for: whatever is still missing, or — when
            // nothing is — every other enabled platform (the user asked for a fresh look).
            const lastResort = this.discoveryServiceRegistry.getConstructor(serviceKey)?.lastResort === true;
            let wanted: Platform[] | undefined;
            if (lastResort) {
                wanted = this.getMissingPlatforms();
                if (wanted.length === 0) {
                    wanted = [...this.metadataServiceRegistry.getAllConstructors().keys()]
                        .filter((k) => this.isMetadataServiceEnabled(k) && k !== primaryMetadata.platform)
                        .sort() as Platform[];
                }
            }
            // Bypass the disk cache so [S] Re-search always fetches fresh data and stores
            // a valid anchor (stale cache entries from old code have the wrong shape).
            await this.runDiscoveryService(service, primaryMetadata, primaryUri, wanted, true);
            this.logger.info(`Re-discovery completed for ${serviceKey}`);
        } catch (error) {
            this.logger.warn(
                `Failed to re-discover ${serviceKey}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    async refetchResult(groupIndex: number, resultIndex: number): Promise<void> {
        const groups = this.getAttributes()?.metadataGroups ?? [];
        const result = groups[groupIndex]?.results[resultIndex];
        if (!result) return;

        const serviceKey = groups[groupIndex].serviceKey;
        const url = result.metadata.url;
        if (!url || !this.isMetadataServiceEnabled(serviceKey)) return;

        this.updateResultInGroup(groupIndex, resultIndex, { fetchState: "loading", fetchError: undefined });

        try {
            const service = this.metadataServices.get(serviceKey);
            const enriched = await service.getTrackMetadata(url);
            this.updateResultInGroup(groupIndex, resultIndex, {
                metadata: enriched,
                fetchState: undefined,
                fetchError: undefined,
            });
        } catch (error) {
            this.updateResultInGroup(groupIndex, resultIndex, {
                fetchState: "error",
                fetchError: error instanceof Error ? error.message : "Refetch failed",
            });
        }
    }

    // ── Links the user added by hand ─────────────────────────────────────────
    //
    // A link the user pastes onto a track is data nobody can regenerate, so it is stored twice: as a result in the
    // metadata groups (what the UI shows) and in `userSources`, which no pipeline step ever clears. Whenever the
    // groups are rebuilt — restart, a stopped task started again, re-discovery — `applyUserSources()` puts every
    // entry back. The entry is written BEFORE anything is fetched, so a crash or a failed fetch loses nothing.

    /**
     * Adds track links to this track as sources: each is recognized by the metadata service that reads that platform,
     * stored, fetched, and shown as a favorited "[USER]" result of that platform. Links no service can read are
     * reported back, not stored.
     */
    async addUserSources(urls: string[]): Promise<AddUserSourcesResult> {
        const added: UserSource[] = [];
        const skipped: { url: string; reason: string }[] = [];
        const attrs = this.getAttributes();
        const own = attrs?.uri ? this.userSourceUri(attrs.uri) : "";

        for (const raw of urls) {
            const url = raw.trim();
            // Whatever was pasted, a service's URL parser must not be able to throw it out of here.
            let recognition: ReturnType<typeof resolveTrackRecognition> = null;
            try {
                recognition = resolveTrackRecognition(url, this.metadataServiceRegistry);
            } catch {
                /* not a link */
            }
            if (!recognition) {
                let kind: string | undefined;
                try {
                    kind = urlParserRegistry.parse(url)?.type;
                } catch {
                    /* not a link */
                }
                skipped.push({
                    url,
                    reason:
                        kind === "album" || kind === "playlist"
                            ? `an ${kind} link: paste the link of the track itself`
                            : "not a track link Goblin Malin can read",
                });
                continue;
            }
            const uri = this.userSourceUri(recognition.uri);
            if (uri === own) {
                skipped.push({ url, reason: "that is this track's own link" });
                continue;
            }
            const current = this.getAttributes()?.userSources ?? [];
            let entry = current.find((s) => s.uri === uri);
            if (!entry) {
                entry = { url, uri, addedAt: new Date().toISOString() };
                this.updateAttributes({ userSources: [...current, entry] });
            }
            added.push(entry);
        }
        for (const entry of added) await this.applyUserSource(entry);
        return { added, skipped };
    }

    /**
     * Deletes a link the user added by hand, for real: its row among the sources AND its durable entry in
     * `userSources` (without that, the next rebuild would put it back). This is the user's own explicit "delete", the
     * only thing that ever removes such an entry; "reject" keeps it. A group the link created, left empty, goes with it.
     * `uri` is the row's `metadata.uri`. Returns false when no such row (the search's own results are never deleted).
     */
    removeUserSource(uri: string): boolean {
        const attrs = this.getAttributes();
        if (!attrs) return false;
        const canonical = (u: string | undefined): string | undefined => {
            const parts = u ? parseTrackUri(u) : null;
            return parts ? this.userSourceUri(parts) : u;
        };
        const target = canonical(uri);
        const isTarget = (r: MetadataResultState) =>
            !!r.addedByUser && !r.isPrimaryInput && canonical(r.metadata.uri) === target;
        if (!attrs.metadataGroups.some((g) => g.results.some(isTarget))) return false;

        const metadataGroups = attrs.metadataGroups
            .map((g) => ({ ...g, results: g.results.filter((r) => !isTarget(r)) }))
            .filter((g, i) => g.results.length > 0 || attrs.metadataGroups[i].results.length === 0);
        const userSources = (attrs.userSources ?? []).filter((s) => canonical(s.uri) !== target);
        this.updateAttributes({ metadataGroups, userSources });
        return true;
    }

    /** The canonical "PLATFORM::TRACK::ID" of a track link (YouTube Music and YouTube are one platform). */
    private userSourceUri(uri: TrackUriParts): string {
        return formatTrackUri({ ...uri, platform: platformRegistry.canonical(uri.platform) as Platform });
    }

    /** Puts every link the user added back among the sources (fetching the ones that are missing or failed). */
    private async applyUserSources(): Promise<void> {
        for (const entry of this.getAttributes()?.userSources ?? []) {
            try {
                await this.applyUserSource(entry);
            } catch (error) {
                this.logger.warn(`Could not restore the link you added: ${entry.url}`, { error });
            }
        }
    }

    private async applyUserSource(entry: UserSource): Promise<void> {
        const recognition = resolveTrackRecognition(entry.url, this.metadataServiceRegistry);
        if (!recognition) {
            // No registered service reads it any more. The entry stays: it comes back when one does.
            this.logger.warn(`No service reads the link you added (kept): ${entry.url}`);
            return;
        }
        const serviceKey = recognition.serviceKey;
        const group = this.getAttributes()?.metadataGroups.find((g) => g.serviceKey === serviceKey);
        const existing = group?.results.find((r) => r.metadata.uri === entry.uri);
        if (existing && !existing.fetchState) {
            if (!existing.addedByUser) this.upsertUserResult(existing.metadata, serviceKey);
            return;
        }

        let metadata: TrackMetadata;
        let fetchState: "error" | undefined;
        let fetchError: string | undefined;
        const label = providerDisplayRegistry.get(serviceKey).label;
        try {
            if (!this.isMetadataServiceEnabled(serviceKey)) throw new Error(`${label} is switched off in Settings`);
            metadata = await this.metadataServices.get(serviceKey).getTrackMetadata(entry.url);
        } catch (error) {
            // Keep the link as a row to retry ([R] Refetch): what the user pasted is never dropped for a failed fetch.
            fetchState = "error";
            fetchError = error instanceof Error ? error.message : "Could not read this link";
            metadata = {
                id: recognition.uri.id,
                trackName: "",
                artists: [],
                url: entry.url,
                uri: entry.uri,
                platform: recognition.uri.platform,
                apiProvider: recognition.uri.platform,
                fetchedAt: new Date(),
                type: "track",
            } as unknown as TrackMetadata;
            this.logger.warn(`Could not read the link you added (${entry.url}): ${fetchError}`);
        }
        this.upsertUserResult(metadata, serviceKey, fetchState, fetchError);
    }

    /** Adds the result of a link the user added, or marks the one that is already there as theirs. */
    private upsertUserResult(
        metadata: TrackMetadata,
        serviceKey: string,
        fetchState?: "error",
        fetchError?: string
    ): void {
        const primary = this.getPrimaryMetadata()?.metadata;
        const source: DiscoverySource = {
            discoveredBy: "user",
            fromUri: primary?.uri ?? primary?.url ?? "",
            searchKeys: ["url"],
        };
        const groups = [...(this.getAttributes()?.metadataGroups ?? [])];
        let groupIdx = groups.findIndex((g) => g.serviceKey === serviceKey);
        if (groupIdx === -1) {
            groups.push({ platform: metadata.platform, serviceKey, rank: groups.length, results: [] });
            groupIdx = groups.length - 1;
        }
        const group: MetadataGroupState = { ...groups[groupIdx], results: [...groups[groupIdx].results] };

        const idx = group.results.findIndex((r) => r.metadata.uri === metadata.uri);
        if (idx !== -1) {
            const current = group.results[idx];
            // The group's favorite becomes this one when it failed before and now reads fine (as if it had worked at
            // once), or when the search had already found it and the user now confirms it by pasting it themselves.
            const becomesFavorite =
                !fetchState &&
                !current.isRejected &&
                (current.fetchState === "error" || (!current.addedByUser && !current.isPrimaryInput));
            group.results = group.results.map((r, i) => {
                if (i !== idx) return becomesFavorite ? { ...r, isFavorited: false } : r;
                return {
                    ...r,
                    addedByUser: true,
                    metadata: fetchState ? r.metadata : metadata,
                    fetchState,
                    fetchError,
                    isFavorited: r.isFavorited || becomesFavorite,
                    discoverySources: r.discoverySources.some((s) => s.discoveredBy === "user")
                        ? r.discoverySources
                        : [...r.discoverySources, source],
                };
            });
        } else {
            // First in its group. Favorited when it reads fine: the user chose it over whatever the search found. A
            // link that failed to load is NOT favorited: an empty favorite would hide the group's real metadata.
            const others = group.results.map((r) => ({
                ...r,
                rank: r.rank + 1,
                isFavorited: fetchState ? r.isFavorited : false,
            }));
            group.results = [
                {
                    metadata,
                    isPrimaryInput: false,
                    isFavorited: !fetchState,
                    isRejected: false,
                    rank: 0,
                    confidence: !fetchState && primary ? computeConfidenceScore(metadata, primary) : undefined,
                    discoverySources: [source],
                    addedByUser: true,
                    fetchState,
                    fetchError,
                },
                ...others,
            ];
        }
        groups[groupIdx] = group;
        this.updateAttributes({ metadataGroups: groups });
    }

    // ── Misc mutations ────────────────────────────────────────────────────────

    @TaskScoped()
    @SafeAction("Restart task")
    async restart(): Promise<void> {
        // The verdict is rebuilt, but what the user decided about it (the release they picked or turned down, the
        // artists they chose) is theirs and stays: the next check applies it again.
        const kept = this.getAttributes()?.musicBrainzIdentity;
        this.updateAttributes({
            state: "pending",
            metadataGroups: [],
            metadataOverride: {},
            musicBrainzIdentity: kept?.userChoice
                ? {
                      ...unknownIdentity("Checking again after the restart", kept),
                      ...(kept.handedOffAt ? { handedOffAt: kept.handedOffAt } : {}),
                  }
                : undefined,
            downloadSources: [],
            primaryMetadataFetched: false,
            metadataDiscovered: false,
            downloadsFetched: false,
        });
        await this.start();
    }

    selectDownloadSource(index: number): void {
        const sources = this.getAttributes()?.downloadSources ?? [];
        this.updateAttributes({
            downloadSources: sources.map((s, i) => ({ ...s, selected: i === index })),
        });
    }

    rejectDownloadSource(index: number, rejected: boolean): void {
        const sources = this.getAttributes()?.downloadSources ?? [];
        if (!sources[index]) return;
        this.updateAttributes({
            downloadSources: sources.map((s, i) =>
                i === index ? { ...s, isRejected: rejected, selected: rejected ? false : s.selected } : s
            ),
        });
        // Rejecting a row that's actively downloading (yt-dlp or one Soulseek
        // candidate) should actually stop it, not just hide it while it keeps
        // running in the background.
        if (rejected) {
            const abort = this.activeAbortBySourceIndex.get(index);
            if (abort) {
                abort();
                this.activeAbortBySourceIndex.delete(index);
            }
        }
    }

    /**
     * Manually download one specific previously-found candidate on demand — e.g. a
     * Soulseek source marked "skipped" (an earlier-ranked candidate already won) or
     * "failed" that the user wants to try anyway. Only touches this one row; unlike
     * `startDownloads()` it never re-selects a different source automatically.
     */
    @TaskScoped()
    @SafeAction("Retry download source")
    async retryDownloadSource(sourceIndex: number): Promise<void> {
        const target = this.getAttributes()?.downloadSources[sourceIndex];
        if (!target || target.retryPayload == null) return;

        const service = this.downloadServices.get(target.provider);
        if (!service.retryCandidate) {
            this.logger.warn(`${target.provider} does not support retrying a specific source`);
            return;
        }

        const patchSource = (patch: TrackDownloadSource) => {
            const current = [...(this.getAttributes()?.downloadSources ?? [])];
            if (!current[sourceIndex]) return;
            current[sourceIndex] = {
                ...patch,
                selected: current[sourceIndex].selected,
                moreCandidates: current[sourceIndex].moreCandidates,
            };
            this.updateAttributes({ downloadSources: current });
        };

        // Reuses the same activeAbortBySourceIndex map startDownloads() populates, so
        // rejectDownloadSource() can cancel a manual retry exactly like any other
        // in-flight row, without needing to know which path started it.
        const retryController = new AbortController();
        try {
            const result = await service.retryCandidate(
                target.track,
                target.retryPayload,
                (source, options) => {
                    if (options?.abort) {
                        this.activeAbortBySourceIndex.set(sourceIndex, options.abort);
                    } else {
                        this.activeAbortBySourceIndex.delete(sourceIndex);
                    }
                    patchSource(source);
                },
                retryController.signal
            );
            this.activeAbortBySourceIndex.delete(sourceIndex);
            patchSource(result);
        } catch (error) {
            this.activeAbortBySourceIndex.delete(sourceIndex);
            // AbortError here means the user rejected this same row mid-retry —
            // expected, not worth an error-level log.
            if ((error as Error).name !== "AbortError") {
                this.logger.warn(`Failed to retry download source ${sourceIndex}`, { error });
            }
            patchSource({ ...target, state: "failed" });
        }
    }

    /** Whether a "show more" row can be acted on now: not while any row is still being worked on (rows would shift under it). */
    canShowMoreSources(): boolean {
        return !(this.getAttributes()?.downloadSources ?? []).some((s) => DownloadTask.isInFlight(s));
    }

    /**
     * Turns the next `count` results a provider found but didn't list (`moreCandidates`, kept on the last
     * listed row of that search) into rows of their own, right under that row. They are "skipped": the user
     * can still download any of them on demand, like any other not-needed row.
     * Returns how many rows were added, so a caller can keep its cursor on the same row.
     */
    showMoreSources(anchorIndex: number, count = 10): number {
        const sources = this.getAttributes()?.downloadSources ?? [];
        const anchor = sources[anchorIndex];
        const pool = anchor?.moreCandidates;
        if (!anchor || !pool || pool.length === 0 || !this.canShowMoreSources()) return 0;

        const batch = pool.slice(0, count);
        const rest = pool.slice(count);
        const rows: TrackDownloadSource[] = batch.map((candidate, i) => ({
            state: "skipped",
            provider: anchor.provider,
            track: anchor.track,
            downloadedAt: new Date(),
            selected: false,
            query: anchor.query,
            ...candidate,
            // The new last row of the listing carries whatever is still hidden.
            moreCandidates: i === batch.length - 1 && rest.length > 0 ? rest : undefined,
        }));

        const next = [...sources];
        next[anchorIndex] = { ...anchor, moreCandidates: undefined };
        next.splice(anchorIndex + 1, 0, ...rows);
        this.updateAttributes({ downloadSources: next });
        return rows.length;
    }

    updateLocalFile(sourceIndex: number, newPath: string): void {
        const sources = this.getAttributes()?.downloadSources ?? [];
        if (!sources[sourceIndex]) return;
        const updated = sources.map((s, i) => {
            if (i !== sourceIndex) return s;
            return {
                ...s,
                localFile: {
                    ...s.localFile!,
                    path: newPath,
                    extension: (extensionOf(newPath) || s.localFile?.extension) as LocalFile["extension"],
                    state: "found" as const,
                    name:
                        newPath
                            .split(/[\\/]/)
                            .pop()
                            ?.replace(/\.[^/.]+$/, "") ??
                        s.localFile?.name ??
                        "",
                },
            };
        });
        this.updateAttributes({ downloadSources: updated });
    }

    /**
     * Points the track's saved file at another place (the user moved it, or restored it): what the app recorded stays
     * as it was, only where to find the file changes.
     */
    relocateSavedFile(newPath: string): void {
        const saved = this.getAttributes()?.savedFile;
        if (!saved) return;
        this.updateAttributes({ savedFile: { ...saved, path: newPath } });
    }

    /** Sets the folder this track is saved to; `undefined` goes back to the folder from Settings. */
    setOutputDir(dir: string | undefined): void {
        this.updateAttributes({ outputDirOverride: dir });
    }

    /** Sets the name this track is saved as (already cleaned); `undefined` goes back to "Artist - Title". */
    setOutputFilename(filename: string | undefined): void {
        this.updateAttributes({ outputFilenameOverride: filename });
    }

    /** Whether saving writes the compiled metadata into the file's tags (see `TrackDownloadTask.overwriteTags`). */
    setOverwriteTags(overwrite: boolean): void {
        this.updateAttributes({ overwriteTags: overwrite });
    }

    /** Whether saving writes the MusicBrainz ids into the tags (see `TrackDownloadTask.includeMusicBrainzTags`). */
    setIncludeMusicBrainzTags(include: boolean): void {
        this.updateAttributes({ includeMusicBrainzTags: include });
    }

    /**
     * Saves the track into the output folder, from the selected download source — or, with `fromSaved`, from the
     * file it is already saved as (re-tag, rename, move: no download is needed, and the format stays).
     *
     * One save at a time per task: a call made while another is running (a held-down key, a second press while the
     * overwrite dialog is open) is ignored. The UI blocks that too, but it only knows once the status says so.
     */
    async saveTrack(options: { fromSaved?: boolean } = {}): Promise<void> {
        const started = await this.saveGuard.run(() => this.runSave(options));
        if (!started) globalLogger.info("Save ignored: this track is already being saved");
    }

    /**
     * The verdict whose IDs may go into the file. One made from other sources than the ones the file is built from
     * (the album was swapped, a field edited) says nothing about this file: it is checked again first, and left out
     * if that cannot be done. Never a wrong release ID in a file because the sources moved on.
     */
    private async musicBrainzIdentityForSave(attrs: TrackDownloadTask): Promise<MusicBrainzIdentity | undefined> {
        const identity = attrs.musicBrainzIdentity;
        if (!identity) return undefined;
        const current = computeCompiledMetadata(attrs.metadataGroups, attrs.metadataOverride);
        if (!isMusicBrainzVerdictStale(identity, current)) return identity;
        if (getMusicSettings().musicBrainz.matchTracks) {
            try {
                const fresh = await this.checkMusicBrainz();
                if (fresh && !isMusicBrainzVerdictStale(fresh, current)) return fresh;
            } catch {
                /* already logged: saving goes on without the IDs */
            }
        }
        this.logger.warn("The MusicBrainz verdict is out of date with the sources: its IDs are not written");
        return undefined;
    }

    private async runSave(options: { fromSaved?: boolean }): Promise<void> {
        const attrs = this.getAttributes();
        const sources = attrs?.downloadSources ?? [];
        const saved = attrs?.savedFile;

        // Where the new saved file comes from: a download row, or the saved file itself.
        const origin = options.fromSaved ? saved : sources.find((s) => s.selected);
        if (!origin) throw new Error(options.fromSaved ? "No saved file" : "No download source selected");
        const selectedSource = options.fromSaved ? undefined : (origin as TrackDownloadSource);
        if (selectedSource && selectedSource.localFile?.state !== "found") throw new Error("Local file not found");
        // Made from the download the track is saved from already (or from the saved file itself): the file is
        // updated in place when its format stays. From any other download it is replaced.
        const sameOrigin = !!saved && (!selectedSource || isSavedFrom(saved, selectedSource));

        const settings = getSaveSettings();
        globalLogger.info("Saving track with settings:", { settings });

        // The track's own choice wins over the setting. Left out, the IDs are not even looked up (a re-check is a
        // network round trip nobody asked for).
        const includeMusicBrainzTags = attrs!.includeMusicBrainzTags ?? settings.includeMusicBrainzTags;
        const compiled = computeCompiledMetadata(
            attrs!.metadataGroups,
            attrs!.metadataOverride,
            includeMusicBrainzTags ? await this.musicBrainzIdentityForSave(attrs!) : undefined
        );
        const tags = compiledMetadataToTags(compiled, { includeMusicBrainzTags });
        const outputDir = attrs!.outputDirOverride ?? settings.outputDir;
        await fs.mkdir(outputDir, { recursive: true });
        // What the file is saved as: the format from Settings (or the download's own), see `planSave`.
        const downloadPath = selectedSource?.localFile?.path;
        const plan = planSave(settings, downloadPath, sameOrigin ? saved?.path : undefined);
        const outputPath = computeOutputPath(compiled, outputDir, attrs!.outputFilenameOverride, plan.extension);
        // Another file with this name is replaced only if the user agrees. The track's own saved file doesn't
        // count: this one replaces it anyway.
        if (isOutputPathTaken(outputPath, [saved?.path]) && !(await overwriteConfirmBridge.confirm(outputPath))) {
            globalLogger.info("Save cancelled: the file name is taken and the user kept the existing file");
            return;
        }

        this.status.update({
            type: StatusType.Processing,
            message: plan.convert ? `Converting to ${plan.extension.toUpperCase()}…` : "Saving…",
        });

        const existingSavedPath = saved?.path ?? null;
        // Only a file made here is deleted when saving fails: a saved file that was merely renamed is the user's.
        let outputCreated = false;

        // A file already at the target (the user agreed to replace it): a failure after it was replaced must not
        // delete it as a file this save created.
        const outputExisted = await fs.access(outputPath).then(
            () => true,
            () => false
        );

        try {
            if (plan.mode === "reuse") {
                // Re-saving same source: re-tag the file where it is, then rename it to its new path if that changed.
                // Tagging first means a failure leaves the file where the task still points at it.
                if (attrs!.overwriteTags !== false) await tagAudioFile(existingSavedPath!, tags);
                if (existingSavedPath !== outputPath) {
                    const { moveFile } = await import("../../../utils/metadata");
                    await moveFile(existingSavedPath!, outputPath);
                }
            } else {
                // New file from the temporary download: a plain copy, or a re-encode into the chosen format. It is
                // built and tagged beside its destination and only then renamed over it, so a failure at any step
                // leaves no partial file and keeps the file the user agreed to replace.
                await writeViaStaging(outputPath, async (staging) => {
                    if (plan.convert) {
                        await convertAudioInto(downloadPath!, staging, parseOutputFormat(plan.extension));
                    } else {
                        await fs.copyFile(downloadPath!, staging);
                    }
                    // Off: the file keeps the tags it came with (it is still copied/renamed/moved as usual).
                    if (attrs!.overwriteTags !== false) await tagAudioFile(staging, tags);
                });
                // From here the file at `outputPath` is complete. If a later step fails, a file this save created
                // is removed again; one that replaced the user's is kept (the old content is gone either way).
                outputCreated = !outputExisted;
            }

            // Only now that the new file is in place is the one it replaces deleted (a file that was updated in
            // place, or kept its name, is the new file itself).
            if (existingSavedPath && plan.mode === "fromDownload" && !samePath(existingSavedPath, outputPath)) {
                await fs.unlink(existingSavedPath).catch((e: NodeJS.ErrnoException) => {
                    if (e.code !== "ENOENT") throw e;
                });
            }

            // The temporary download no longer describes a re-encoded file: remember what was really written.
            const reencoded = plan.mode === "fromDownload" ? plan.convert : !!saved?.converted;
            const converted = reencoded
                ? { format: plan.extension, sizeBytes: (await fs.stat(outputPath)).size }
                : undefined;

            // What the file was made from is kept with it: the download rows may all be replaced later.
            this.updateAttributes({
                savedFile: {
                    path: outputPath,
                    savedAt: new Date(),
                    provider: origin.provider,
                    track: origin.track,
                    providerDetail: origin.providerDetail,
                    fileInfo: origin.fileInfo,
                    downloadPath: selectedSource ? selectedSource.localFile?.path : saved?.downloadPath,
                    converted,
                    // What was just written; when the file kept its own tags, what was known before.
                    tags:
                        attrs!.overwriteTags !== false
                            ? compiledFieldValues(compiled)
                            : sameOrigin
                              ? saved?.tags
                              : undefined,
                },
            });

            // The file now belongs to this task: another one that saved a file under this path (and was replaced
            // by the confirm above) must not keep treating it as its own.
            const released = releaseSavedFile(TaskOrchestrator.getInstance().getTasks(), outputPath, this.getId());
            if (released.length > 0) {
                globalLogger.info(`${outputPath} replaced the saved file of ${released.length} other task(s)`);
            }

            this.status.set({ type: StatusType.Success, message: "Saved" });
        } catch (err) {
            if (outputCreated) {
                await fs.unlink(outputPath).catch(() => {});
            }
            this.status.set({ type: StatusType.Error, message: "Save failed" });
            throw err;
        }
    }

    /**
     * Runs one download service for this track: finds the metadata it can use, lets it search and download,
     * and writes every row it reports into `downloadSources`. Never throws for a failed attempt (that just
     * leaves a failed row); only a task-level abort propagates.
     *
     * New rows are appended, or spliced in from `insertAt` on (a re-run of one provider keeps its place in
     * the list instead of jumping to the bottom).
     */
    private async runDownloadService(
        downloadService: DownloadService,
        signal?: AbortSignal,
        insertAt?: number,
        options: {
            /** Files this service may download (the strategy's limit); left out, the service's own default of one. */
            maxDownloads?: number;
            /** The service is not used this time: only a "skipped" row is left under this provider key. */
            skipAs?: string;
        } = {}
    ): Promise<void> {
        const metadataGroups = this.getAttributes()?.metadataGroups ?? [];
        let createdRows = 0;

        // Every row update round-trips through the live persisted attributes rather
        // than a locally-accumulated array — a service call can be in flight for
        // seconds (Soulseek candidates especially), during which the user can mutate
        // a row directly (rejectDownloadSource, selectDownloadSource). A stale local
        // copy would silently clobber that (e.g. a "failed" update arriving after an
        // abort would wipe the `isRejected` flag that abort was supposed to set).
        // Returns the slot index actually used (existing or newly created).
        const applyRowUpdate = (existingSlot: number | undefined, patch: TrackDownloadSource): number => {
            const current = [...(this.getAttributes()?.downloadSources ?? [])];
            let slotIndex: number;
            if (existingSlot === undefined) {
                slotIndex = insertAt === undefined ? current.length : insertAt + createdRows;
                createdRows++;
                current.splice(slotIndex, 0, patch);
            } else {
                slotIndex = existingSlot;
                const live = current[slotIndex];
                // `moreCandidates` is set once, on the row that ends the listing; later updates to that
                // row (it may be attempted too) don't repeat it, so it must survive them.
                current[slotIndex] = live
                    ? {
                          ...patch,
                          selected: live.selected,
                          isRejected: live.isRejected,
                          moreCandidates: patch.moreCandidates ?? live.moreCandidates,
                      }
                    : patch;
            }
            this.updateAttributes({ downloadSources: current });
            return slotIndex;
        };

        try {
            // Find first compatible metadata across groups (sorted by group rank, then result rank)
            let compatibleMetadata: TrackMetadata | undefined;
            for (const group of [...metadataGroups].sort((a, b) => a.rank - b.rank)) {
                for (const result of [...group.results].sort((a, b) => a.rank - b.rank)) {
                    if (
                        !result.isRejected &&
                        result.fetchState !== "loading" &&
                        downloadService.canDownload(result.metadata)
                    ) {
                        compatibleMetadata = result.metadata;
                        break;
                    }
                }
                if (compatibleMetadata) break;
            }

            if (!compatibleMetadata) {
                this.logger.warn(`No compatible metadata found for ${downloadService.id}`);
                return;
            }

            // A free-text search provider (e.g. Soulseek) isn't really tied to
            // whichever group happened to rank first — overlay the task's compiled
            // (merged + user-overridden) fields so the query, and what the UI shows
            // as "used …", reflect the actual current metadata instead of one
            // arbitrary source's raw values.
            if (downloadService.usesCompiledMetadataForQuery) {
                const compiled = computeCompiledMetadata(metadataGroups, this.getAttributes()?.metadataOverride ?? {});
                compatibleMetadata = {
                    ...compatibleMetadata,
                    trackName: compiled.trackName || compatibleMetadata.trackName,
                    artists: compiled.artists.length > 0 ? compiled.artists : compatibleMetadata.artists,
                    album: compiled.album ?? compatibleMetadata.album,
                    duration: compiled.duration ?? compatibleMetadata.duration,
                };
            }

            // Not needed (an earlier provider already downloaded the track): a row says so, and keeps the provider
            // listed so that it can still be run by hand ("retry provider").
            if (options.skipAs) {
                applyRowUpdate(undefined, {
                    state: "skipped",
                    provider: options.skipAs as TrackDownloadSource["provider"],
                    track: compatibleMetadata,
                    downloadedAt: new Date(),
                    selected: false,
                });
                return;
            }

            this.logger.info(`Downloading using ${downloadService.id} from ${compatibleMetadata.apiProvider}`);

            // Reserve slot(s) for this service. The service emits intermediate sources
            // (e.g. "downloading" + progress) via onUpdate so the UI can show the
            // download in progress before it completes. `selected` is owned by this
            // task, so it is preserved across intermediate updates. A service that
            // tries multiple candidates for one track (e.g. Soulseek working through a
            // ranked peer list) can address each with a stable `attemptId`: the first
            // update for an id opens its own row, later updates with the same id
            // update that exact row — so every real attempt (pending/downloading/
            // failed/downloaded) shows as its own row instead of one shared status.
            // Services that never pass an `attemptId` (e.g. yt-dlp) keep the original
            // single-row behavior via the implicit `undefined` key.
            const slotByAttemptId = new Map<string | undefined, number>();
            let lastAttemptId: string | undefined;
            const onUpdate = (source: TrackDownloadSource, options?: DownloadUpdateOptions) => {
                const attemptId = options?.attemptId;
                lastAttemptId = attemptId;
                const slotIndex = applyRowUpdate(slotByAttemptId.get(attemptId), source);
                slotByAttemptId.set(attemptId, slotIndex);
                if (options?.abort) {
                    this.activeAbortBySourceIndex.set(slotIndex, options.abort);
                } else {
                    this.activeAbortBySourceIndex.delete(slotIndex);
                }
            };

            // Download the track
            const downloadSource = await downloadService.downloadTrack(
                compatibleMetadata,
                onUpdate,
                signal,
                options.maxDownloads !== undefined ? { maxDownloads: options.maxDownloads } : undefined
            );
            const finalSlot = applyRowUpdate(slotByAttemptId.get(lastAttemptId), downloadSource);
            this.activeAbortBySourceIndex.delete(finalSlot);
            this.logger.info(`Successfully downloaded using ${downloadService.id}`);
        } catch (error) {
            // Only a genuine task-level abort (the signal passed into the whole stage) should stop it.
            // A service can also throw AbortError when just *one row* was cancelled (e.g. the user
            // rejected a source mid-download via its per-row `abort` handle) — that
            // should only fail this one service's attempt, not the rest of the task.
            if (signal?.aborted) throw error;
            this.logger.warn(`Failed to download using ${downloadService.id}:`, { error });
        }
    }

    /** Whether a download row is still being worked on (as opposed to settled: downloaded, failed, skipped). */
    private static isInFlight(source: TrackDownloadSource): boolean {
        return source.state === "pending" || source.state === "searching" || source.state === "downloading";
    }

    /**
     * Whether `provider`'s whole search + download can be re-run now. Not while the first pass is still going,
     * or while another provider's rows are being worked on (replacing this provider's rows shifts their positions).
     * A saved file doesn't get in the way: it is the task's own record, not one of the rows that are replaced.
     */
    canRetryDownloadProvider(provider: string): boolean {
        const attrs = this.getAttributes();
        if (!attrs || attrs.kind !== "track" || !attrs.downloadsFetched) return false;
        if (!this.isDownloadServiceEnabled(provider)) return false;
        const sources = attrs.downloadSources;
        if (!sources.some((s) => s.provider === provider)) return false;
        if (this.retryingProviders.has(provider)) return false;
        return !sources.some((s) => s.provider !== provider && DownloadTask.isInFlight(s));
    }

    /**
     * Re-runs the search and download of one provider from scratch (e.g. Soulseek after the metadata was
     * corrected, or yt-dlp after a network error): its previous rows are replaced, in place, by whatever the
     * new attempt produces. The other providers' rows are untouched.
     */
    @TaskScoped()
    @SafeAction("Retry download provider")
    async retryDownloadProvider(provider: string): Promise<void> {
        if (!this.canRetryDownloadProvider(provider)) return;
        const service = this.downloadServices.get(provider);

        this.retryingProviders.add(provider);
        try {
            // Like the first pass, wait for a download slot. The old rows stay visible until it is this
            // provider's turn, so the list does not blank out while the retry is queued.
            await downloadLimiter.run(async () => {
                const before = this.getAttributes()?.downloadSources ?? [];
                // Another provider's row may have started while this waited: replacing this provider's rows
                // would shift the positions its updates are addressed to.
                if (before.some((s) => s.provider !== provider && DownloadTask.isInFlight(s))) return;

                const firstIndex = before.findIndex((s) => s.provider === provider);
                if (firstIndex === -1) return;
                // A row of this provider still in flight is cancelled; the cancel handles are keyed by the
                // very indices that are about to go away.
                before.forEach((s, i) => {
                    if (s.provider !== provider) return;
                    this.activeAbortBySourceIndex.get(i)?.();
                    this.activeAbortBySourceIndex.delete(i);
                });
                const hadSelected = before.some((s) => s.provider === provider && s.selected);

                this.updateAttributes({ downloadSources: before.filter((s) => s.provider !== provider) });
                await this.runDownloadService(service, undefined, firstIndex, {
                    maxDownloads: maxDownloadsPerProvider(
                        parseDownloadStrategy(getMusicSettings().download.downloadStrategy)
                    ),
                });

                // The selected row went away with its provider: pick again, as the first pass does. A
                // selection that lives on another provider is the user's, and stays.
                if (hadSelected) {
                    const sources = this.getAttributes()?.downloadSources ?? [];
                    const picked = pickAutoSelectedIndex(sources, getMusicSettings().download.preferLossless);
                    this.updateAttributes({
                        downloadSources: sources.map((s, i) => ({ ...s, selected: i === picked })),
                    });
                }
            });
        } finally {
            this.retryingProviders.delete(provider);
        }
    }

    @TaskScoped()
    @SafeAction("Start downloads")
    async startDownloads(signal?: AbortSignal): Promise<void> {
        const metadataGroups = this.getAttributes()?.metadataGroups;

        if (!metadataGroups || metadataGroups.length === 0) {
            this.logger.warn("No metadata groups available for download");
            throw new Error("No metadata groups available for download");
        }

        this.logger.info(`Starting downloads with ${metadataGroups.length} metadata groups`);
        // Only the download rows are redone: the saved file is the task's own record (`savedFile`) and stays.
        this.updateAttributes({ downloadSources: [], downloadsFetched: false });

        // How many files the track downloads: see `downloadStrategy.ts`. Providers are asked in registry order.
        const strategy = parseDownloadStrategy(getMusicSettings().download.downloadStrategy);
        const maxDownloads = maxDownloadsPerProvider(strategy);
        for (const [provider, downloadService] of this.downloadServices.getAllEntries()) {
            throwIfAborted(signal);
            const done = (this.getAttributes()?.downloadSources ?? []).some((s) => s.state === "downloaded");
            if (done && stopsAtFirstDownload(strategy)) {
                this.logger.info(`Not using ${provider}: a file is already downloaded`);
                await this.runDownloadService(downloadService, signal, undefined, { skipAs: provider });
                continue;
            }
            await this.runDownloadService(downloadService, signal, undefined, { maxDownloads });
        }

        // Auto-select the best downloaded source — lossless-first when preferLossless
        // is on (the default), otherwise the first successfully downloaded source.
        // Read fresh rather than any locally-accumulated array, for the same reason
        // applyRowUpdate does above.
        const finalSources = this.getAttributes()?.downloadSources ?? [];
        const preferLossless = getMusicSettings().download.preferLossless;
        const autoSelectedIdx = pickAutoSelectedIndex(finalSources, preferLossless);
        const sourcesWithSelection = finalSources.map((s, i) => ({
            ...s,
            selected: i === autoSelectedIdx,
        }));

        this.updateAttributes({ downloadSources: sourcesWithSelection });
        this.updateAttributes({ downloadsFetched: true });

        if (finalSources.length === 0) {
            this.logger.warn("No successful downloads");
        } else {
            this.logger.info(
                `Completed downloads: ${finalSources.filter((s) => s.state === "downloaded").length} successful, ${finalSources.filter((s) => s.state === "failed").length} failed`
            );
        }
    }
}
