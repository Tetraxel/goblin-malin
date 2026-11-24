import { ServiceRegistry } from "#base/service-registry";
import type { MetadataService } from "./metadataService";
import type { DiscoveryMetadataService } from "./discoveryMetadataService";
import type { DownloadService } from "./downloadService";
import type { DownloadTask } from "./utils/downloadTask";
import type { StemSeparationService } from "./stems/stemService";

// The three provider registries, as module singletons. This is the app's real
// extensibility axis: adding a provider = one service class + one register()
// call in init.ts. Type-only imports keep this module free of runtime cycles.
export const metadataServiceRegistry = new ServiceRegistry<DownloadTask, MetadataService>();
export const discoveryServiceRegistry = new ServiceRegistry<DownloadTask, DiscoveryMetadataService>();
export const downloadServiceRegistry = new ServiceRegistry<DownloadTask, DownloadService>();

// Stem separation (P33): splits a track's file into stems, on request only (never a pipeline stage).
// Type-only import, like the others: see stems/stemService.ts for what a provider declares.
export const stemServiceRegistry = new ServiceRegistry<DownloadTask, StemSeparationService>();
