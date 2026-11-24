import { ServiceBase } from "#base/service-base";
import { type Logger } from "#base/logger/logger";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsRow, type ProviderSettingsSchema } from "#base/providerSettings";
import { type StemKind } from "../types";
import { type DownloadTask } from "../utils/downloadTask";

/** A model a stem separation engine can run. */
export type StemModel = {
    /** What the engine is given to run it (audio-separator: the model's file name, `htdemucs_ft.yaml`). */
    id: string;
    /** The name people read ("Demucs v4: htdemucs_ft"). */
    label: string;
    /** The model family ("Demucs", "MDXC"…). */
    family: string;
    /** The stems it makes, lower case. Empty when the engine does not say (only a run tells). */
    stems: StemKind[];
    /** Its files are on disk: a separation can use it without downloading anything. */
    downloaded: boolean;
    /** Bytes on disk, once downloaded. */
    sizeBytes?: number;
};

/** Where a long step (an install, a model download, a separation) is: `fraction` of the current step, 0–1. */
export type StemProgress = { text: string; fraction?: number };

export type StemDevice = "cuda" | "cpu";

/** What the engine's settings row and the agent tools say about it. */
export type StemEngineStatus = {
    installed: boolean;
    /** The engine's own version, once installed. */
    version?: string;
    /** The build installed: one for NVIDIA cards (CUDA) or one for the processor only. */
    build?: StemDevice;
    /** Bytes on disk of the engine (Python, PyTorch…), without the models. */
    engineBytes?: number;
    /** Bytes on disk of the downloaded models. */
    modelBytes?: number;
};

export type SeparateRequest = {
    /** The audio file to separate. */
    input: string;
    model: string;
    device: StemDevice;
    /** Folder the stems are written to. */
    outDir: string;
    /** Each stem is written as `<baseName>.<stem>.flac`. */
    baseName: string;
    signal: AbortSignal;
    onProgress: (progress: StemProgress) => void;
    logger: Logger;
};

/** One stem a separation wrote. */
export type SeparatedStem = { kind: StemKind; path: string };

/**
 * The program that separates, shared by every task (installing it, its models). A service class exposes it as
 * `static engine`: Settings → Stems and Claude's tools read it through `getStemEngine()`, never by provider key.
 */
export interface StemEngine {
    status(): Promise<StemEngineStatus>;
    /** The build installed, `undefined` when the engine is not: a cheap check (no folder sizes) for starting a run. */
    installedBuild(): Promise<StemDevice | undefined>;
    /** The NVIDIA card found on this computer, if any (for the CUDA build). */
    detectGpu(): Promise<string | undefined>;
    install(
        build: StemDevice,
        options: { signal?: AbortSignal; onProgress?: (p: StemProgress) => void }
    ): Promise<void>;
    uninstall(): Promise<void>;
    /** Every model the engine can run; `refresh` reads the list from the engine again. */
    listModels(options?: { refresh?: boolean }): Promise<StemModel[]>;
    downloadModel(id: string, options: { signal?: AbortSignal; onProgress?: (p: StemProgress) => void }): Promise<void>;
    removeModel(id: string): Promise<void>;
    separate(request: SeparateRequest): Promise<SeparatedStem[]>;
}

/**
 * Base class of a stem separation provider (P33). One `stemServiceRegistry.register(MyService)` in `initMusicApp()`
 * adds one. What the class declares is read generically, like the other providers: `display`, `summary`,
 * `defaultSettings` (with `enabled` false: nothing is installed until the user asks), `settingsRows`,
 * `settingsStatus` and `engine`.
 */
export abstract class StemSeparationService extends ServiceBase {
    constructor(serviceName: string, task: DownloadTask, logger: Logger) {
        super(serviceName, task, logger);
    }

    /** Separates one file with the engine of the class. Throws on failure; an abort stops the program. */
    abstract separate(request: Omit<SeparateRequest, "logger">): Promise<SeparatedStem[]>;
}

/** What `stemServiceRegistry` keeps of a stem service class. */
export type StemServiceConstructor = {
    new (task: DownloadTask, logger: Logger): StemSeparationService;
    display?: ProviderDisplay;
    summary?: string;
    defaultSettings?: ProviderSettingsSchema;
    settingsRows?: (stored: Record<string, boolean | string>, status: string | undefined) => ProviderSettingsRow[];
    settingsStatus?: () => Promise<string | undefined>;
    engine: StemEngine;
    /** The model a first separation uses when the user has not chosen one. */
    defaultModel: string;
};
