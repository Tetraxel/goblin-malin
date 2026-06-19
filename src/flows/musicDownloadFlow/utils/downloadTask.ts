import fs from "fs/promises";
import { Task } from "#base/task/task";
import { globalLogger, Logger } from "#base/logger/logger";
import { ServiceRegistry } from "#base/service-registry";
import { ServiceScope } from "#base/service-scope";
import { StatusType } from "#base/task/task-status";
import {
    MusicDownloadTaskAttributes,
    TrackMetadata,
    TrackDownloadSource,
    MetadataGroupState,
    MetadataResultState,
    DiscoverySource,
} from "#flows/musicDownloadFlow/types";
import { cleanAndTagFlac } from "#utils/metadata";
import { SafeAction } from "#utils/decorators";
import { computeConfidenceScore } from "./confidence";
import { computeCompiledMetadata } from "./compiledMetadata";
import { compiledMetadataToTags } from "./compiledMetadataToTags";
import { computeOutputPath } from "./computeOutputPath";
import { MetadataService } from "../metadataService";
import { DiscoveryMetadataService } from "../discoveryMetadataService";
import { DownloadService } from "../downloadService";
import { getSaveSettings } from "../saveSettings";

export class DownloadTask extends Task<MusicDownloadTaskAttributes> {
    private metadataServices: ServiceScope<DownloadTask, MetadataService>;
    private discoveryServices: ServiceScope<DownloadTask, DiscoveryMetadataService>;
    private downloadServices: ServiceScope<DownloadTask, DownloadService>;
    private metadataServiceRegistry: ServiceRegistry<DownloadTask, MetadataService>;
    private isMetadataServiceEnabled: (key: string) => boolean;

    constructor({
        id,
        initialInput,
        attributes,
        flowId,
        logger,
        metadataServiceRegistry,
        discoveryServiceRegistry,
        downloadServiceRegistry,
        isMetadataServiceEnabled,
        isDiscoveryServiceEnabled,
        isDownloadServiceEnabled,
    }: {
        id: string;
        initialInput?: string;
        attributes?: MusicDownloadTaskAttributes;
        flowId: string;
        logger: Logger;
        metadataServiceRegistry: ServiceRegistry<DownloadTask, MetadataService>;
        discoveryServiceRegistry: ServiceRegistry<DownloadTask, DiscoveryMetadataService>;
        downloadServiceRegistry: ServiceRegistry<DownloadTask, DownloadService>;
        isMetadataServiceEnabled: (key: string) => boolean;
        isDiscoveryServiceEnabled: (key: string) => boolean;
        isDownloadServiceEnabled: (key: string) => boolean;
    }) {
        super({ id, initialInput, attributes, flowId, logger });

        this.metadataServiceRegistry = metadataServiceRegistry;
        this.isMetadataServiceEnabled = isMetadataServiceEnabled;
        this.metadataServices = metadataServiceRegistry.createScope(this, this.logger, isMetadataServiceEnabled);
        this.discoveryServices = discoveryServiceRegistry.createScope(this, this.logger, isDiscoveryServiceEnabled);
        this.downloadServices = downloadServiceRegistry.createScope(this, this.logger, isDownloadServiceEnabled);
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

    @SafeAction("Start task")
    async start(): Promise<void> {
        try {
            if (this.getAttributes()?.state !== "pending") {
                this.logger.info(`Skipping because task already processed ${this.getInitialInput()}`);
                return;
            }

            this.logger.info(`Starting to process ${this.getInitialInput()}`);
            this.updateAttributes({ state: "running" });

            if (this.getAttributes()?.toTag) {
                // If primary metadata is not fetched -> fetch it
                if (!this.getPrimaryMetadata()) {
                    await this.startPrimaryMetadataFetching();
                }
                await this.startMetadataDiscovering();
            }

            if (this.getAttributes()?.toDownload) {
                await this.startDownloads();
            }
            this.updateAttributes({ state: "finished" });
        } catch (error) {
            this.updateAttributes({ state: "failed" });
            throw error;
        }
    }

    // ── Primary metadata ──────────────────────────────────────────────────────

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
                        const discovered = await discoveryService.discoverFromUri(stubMetadata);
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
        this.updateAttributes({ primaryMetadataFetched: true });
    }

    // ── Discovery ─────────────────────────────────────────────────────────────

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
                results: g.results.filter((r) => r.isPrimaryInput),
            })),
            metadataDiscoveringInProgress: true,
            metadataDiscovered: false,
        });

        try {
            // Phase A — MetadataService.searchTrack (like Spotify, Youtube, etc.)
            const services = this.metadataServices.getAllServices();
            for (const service of services) {
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

            // Phase B — DiscoveryMetadataService.discoverFromUri (like Songlink)
            for (const discoveryService of this.discoveryServices.getAllServices()) {
                try {
                    const allDiscovered = await discoveryService.discoverFromUri(primaryMetadata);
                    // Exclude the primary platform — it's already handled
                    const discovered = allDiscovered.filter((m) => m.platform !== primaryMetadata.platform);

                    for (const rudimentary of discovered) {
                        const targetServiceKey = this.findServiceKeyForPlatform(rudimentary.platform);
                        if (!targetServiceKey) continue;

                        // A DiscoveryMetadataService must tag each result with its own key via fetchedBy.
                        if (!rudimentary.fetchedBy) {
                            this.logger.warn(
                                `Discovery result missing fetchedBy from ${discoveryService.id}; skipping`
                            );
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
                            searchKeys: ["url"],
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

                            if (this.isMetadataServiceEnabled(targetServiceKey) && rudimentary.url) {
                                try {
                                    const service = this.metadataServices.get(targetServiceKey);
                                    finalMetadata = await service.getTrackMetadata(rudimentary.url);
                                } catch {
                                    fetchState = "error";
                                    fetchError = "Enrichment failed";
                                    finalMetadata = rudimentary;
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
        } finally {
            this.updateAttributes({ metadataDiscoveringInProgress: false });
        }
        this.updateAttributes({ metadataDiscovered: true });
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
        for (const [key] of this.metadataServiceRegistry.getAllConstructors()) {
            if (key === platform) return key;
            // youtubeMusic → youtube service
            if (platform === "youtubeMusic" && key === "youtube") return key;
        }
        return undefined;
    }

    // ── Re-search / Re-fetch ─────────────────────────────────────────────────

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

    // ── Misc mutations ────────────────────────────────────────────────────────

    @SafeAction("Restart task")
    async restart(): Promise<void> {
        this.updateAttributes({
            state: "pending",
            metadataGroups: [],
            metadataOverride: {},
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

    async saveTrack(): Promise<void> {
        const attrs = this.getAttributes();
        const sources = attrs?.downloadSources ?? [];
        const selectedSource = sources.find((s) => s.selected);

        if (!selectedSource) throw new Error("No download source selected");
        if (selectedSource.localFile?.state !== "found") throw new Error("Local file not found");

        const settings = getSaveSettings();
        globalLogger.info("Saving track with settings:", { settings });

        const compiled = computeCompiledMetadata(attrs!.metadataGroups, attrs!.metadataOverride);
        const tags = compiledMetadataToTags(compiled, {
            includeMusicBrainzTags: settings.includeMusicBrainzTags,
        });
        const outputPath = computeOutputPath(compiled, settings.outputDir);

        this.status.update({ type: StatusType.Processing, message: "Saving…" });

        const existingSavedPath = selectedSource.savedFile?.path ?? null;
        let outputCreated = false;

        try {
            // Delete saved files from other sources (they're being replaced)
            for (const src of sources) {
                if (src !== selectedSource && src.savedFile) {
                    try {
                        await fs.unlink(src.savedFile.path);
                    } catch (e: unknown) {
                        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
                    }
                }
            }

            if (existingSavedPath) {
                // Re-saving same source: rename to new path if it changed, otherwise just re-tag
                if (existingSavedPath !== outputPath) {
                    const { moveFile } = await import("../../../utils/metadata");
                    await moveFile(existingSavedPath, outputPath);
                }
                outputCreated = true;
            } else {
                // New source: copy temp file to output dir
                await fs.copyFile(selectedSource.localFile!.path, outputPath);
                outputCreated = true;
            }

            await cleanAndTagFlac(outputPath, tags);

            this.updateAttributes({
                downloadSources: sources.map((s) =>
                    s === selectedSource
                        ? { ...s, savedFile: { path: outputPath, savedAt: new Date() } }
                        : { ...s, savedFile: undefined }
                ),
            });

            this.status.set({ type: StatusType.Success, message: "Saved" });
        } catch (err) {
            if (outputCreated) {
                await fs.unlink(outputPath).catch(() => {});
            }
            this.status.set({ type: StatusType.Error, message: "Save failed" });
            throw err;
        }
    }

    @SafeAction("Start downloads")
    async startDownloads(): Promise<void> {
        const metadataGroups = this.getAttributes()?.metadataGroups;

        if (!metadataGroups || metadataGroups.length === 0) {
            this.logger.warn("No metadata groups available for download");
            throw new Error("No metadata groups available for download");
        }

        this.logger.info(`Starting downloads with ${metadataGroups.length} metadata groups`);
        this.updateAttributes({ downloadSources: [], downloadsFetched: false });

        const downloadServices = this.downloadServices.getAllServices();
        const downloadSources: TrackDownloadSource[] = [];

        for (const downloadService of downloadServices) {
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
                    continue;
                }

                this.logger.info(`Downloading using ${downloadService.id} from ${compatibleMetadata.apiProvider}`);

                // Reserve a slot for this service. The service emits intermediate sources
                // (e.g. "downloading" + progress) via onUpdate so the UI can show the
                // download in progress before it completes. `selected` is owned by this
                // task, so it is preserved across intermediate updates.
                let slotIndex = -1;
                const onUpdate = (source: TrackDownloadSource) => {
                    if (slotIndex === -1) {
                        slotIndex = downloadSources.length;
                        downloadSources.push(source);
                    } else {
                        downloadSources[slotIndex] = { ...source, selected: downloadSources[slotIndex].selected };
                    }
                    this.updateAttributes({ downloadSources: [...downloadSources] });
                };

                // Download the track
                const downloadSource = await downloadService.downloadTrack(compatibleMetadata, onUpdate);
                if (slotIndex === -1) {
                    downloadSources.push(downloadSource);
                } else {
                    downloadSources[slotIndex] = { ...downloadSource, selected: downloadSources[slotIndex].selected };
                }
                this.updateAttributes({ downloadSources: [...downloadSources] });
                this.logger.info(`Successfully downloaded using ${downloadService.id}`);
            } catch (error) {
                this.logger.warn(`Failed to download using ${downloadService.id}:`, { error });
                // Continue to next download service
            }
        }

        // Only the first successfully downloaded source is auto-selected
        const firstDownloadedIdx = downloadSources.findIndex((s) => s.state === "downloaded");
        const sourcesWithSelection = downloadSources.map((s, i) => ({
            ...s,
            selected: i === firstDownloadedIdx,
        }));

        this.updateAttributes({ downloadSources: sourcesWithSelection });
        this.updateAttributes({ downloadsFetched: true });

        if (downloadSources.length === 0) {
            this.logger.warn("No successful downloads");
        } else {
            this.logger.info(
                `Completed downloads: ${downloadSources.filter((s) => s.state === "downloaded").length} successful, ${downloadSources.filter((s) => s.state === "failed").length} failed`
            );
        }
    }
}
