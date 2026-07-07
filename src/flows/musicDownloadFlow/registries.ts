import { ServiceRegistry } from "#base/service-registry";
import type { MetadataService } from "./metadataService";
import type { DiscoveryMetadataService } from "./discoveryMetadataService";
import type { DownloadService } from "./downloadService";
import type { DownloadTask } from "./utils/downloadTask";

// The three provider registries, as module singletons. This is the app's real
// extensibility axis: adding a provider = one service class + one register()
// call in init.ts. Type-only imports keep this module free of runtime cycles.
export const metadataServiceRegistry = new ServiceRegistry<DownloadTask, MetadataService>();
export const discoveryServiceRegistry = new ServiceRegistry<DownloadTask, DiscoveryMetadataService>();
export const downloadServiceRegistry = new ServiceRegistry<DownloadTask, DownloadService>();
