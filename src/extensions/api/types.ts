/**
 * The public API of Goblin Malin extensions (P34), version 1.
 *
 * This file is the contract with extension authors: everything an extension can rely on is declared here, and is
 * published as the `goblin-malin/extension-api` types. A change that breaks an extension bumps
 * `EXTENSION_API_VERSION` (`#constants`); `tests/unit/extensionApiSnapshot.test.ts` fails when this file changes
 * without `yarn run extension-api --write` (which records its shape and version).
 *
 * The API is **handed in, never imported**: `activate(goblin)` receives this object. An extension that imported its
 * own copy of the app would get other classes (the registries would refuse its providers) and a stock Ink.
 *
 * Only type imports here, and only of things that are part of the API (the provider base classes and the shapes
 * they use).
 */
import type { MetadataService } from "../../flows/musicDownloadFlow/metadataService";
import type { DiscoveryMetadataService } from "../../flows/musicDownloadFlow/discoveryMetadataService";
import type { DownloadService } from "../../flows/musicDownloadFlow/downloadService";
import type { StemSeparationService } from "../../flows/musicDownloadFlow/stems/stemService";
import type { ServiceBase } from "../../base/service-base";
import type {
    ConfirmDialog,
    InputDialog,
    ListAnswer,
    ListDialog,
    MatrixAnswer,
    MatrixDialog,
} from "../../base/bridges/dialogBridge";
import type { ProviderSettingsRow } from "../../base/providerSettings";

export type {
    MetadataService,
    DiscoveryMetadataService,
    DownloadService,
    StemSeparationService,
    ServiceBase,
    ConfirmDialog,
    InputDialog,
    ListAnswer,
    ListDialog,
    MatrixAnswer,
    MatrixDialog,
    ProviderSettingsRow,
};
export type {
    TrackMetadata,
    SearchTrackResult,
    DiscoveryResult,
    TrackDownloadSource,
} from "../../flows/musicDownloadFlow/types";

// ── The manifest ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One setting an extension declares; drawn in Settings → Extensions with the app's own row kinds. */
export type ExtensionSettingDef =
    | { kind: "checkbox"; label: string; defaultValue: boolean }
    | { kind: "textInput"; label: string; defaultValue: string }
    | { kind: "select"; label: string; defaultValue: string; options: readonly string[] };

export type ExtensionSettingsSchema = Record<string, ExtensionSettingDef>;

/** `extension.json`, at the root of the extension's folder. */
export interface ExtensionManifest {
    /** Lower case letters, digits and dashes, 2–40 characters; the folder is usually named the same. Prefixes everything it registers. */
    name: string;
    /** Shown to the user. Defaults to `name`. */
    displayName?: string;
    /** Its own version (semver). */
    version: string;
    /** The API version it was written for. The app loads it only when it is the app's own. */
    apiVersion: number;
    /** The JavaScript module (ESM) whose default export (or `activate` export) is `activate`. Default `index.js`. */
    entry?: string;
    /** One sentence for the user. */
    description?: string;
    author?: string;
    homepage?: string;
    /** Its settings, shown in Settings → Extensions (they can also be given to `activate`'s return value). */
    settings?: ExtensionSettingsSchema;
}

// ── What the extension sees of the tasks ─────────────────────────────────────────────────────────────────────────

/** A metadata result shown among a track's sources. */
export type SourceView = Readonly<{
    /** The platform's registry key ("spotify", "bandcamp.bandcamp"). */
    platform: string;
    url: string;
    title: string;
    artists: readonly string[];
    album?: string;
    isrc?: string;
    durationMs?: number;
    /** The track's own link (what was imported). */
    primary: boolean;
    rejected: boolean;
    /** The user pasted it onto the track. */
    addedByUser: boolean;
}>;

/** A download row (a candidate file). */
export type DownloadView = Readonly<{
    /** Stable id of the row, for `tasks.edit(id).selectDownload()` (changes when the downloads are redone). */
    id: string;
    /** The download provider's registry key ("ytdlp", "soulseek"). */
    provider: string;
    state: "pending" | "searching" | "downloading" | "downloaded" | "failed" | "skipped";
    selected: boolean;
    rejected: boolean;
    /** The temporary file, once downloaded. */
    path?: string;
    format?: string;
    bitrateKbps?: number;
    sizeBytes?: number;
}>;

export type SavedFileView = Readonly<{
    path: string;
    /** File extension, lower case ("flac"). */
    format: string;
    /** ISO date. */
    savedAt: string;
    /** The download provider the file was made from. */
    provider: string;
}>;

/** A track as an extension reads it: a frozen copy, never the live task. */
export type TrackView = Readonly<{
    id: string;
    kind: "track";
    /** pending · running · finished · failed · stopped */
    state: string;
    /** The status line the list shows ("Saved", "Queued"…). */
    status?: string;
    /** Something works on it right now (a run, a part run, a download). Writes are refused meanwhile. */
    busy: boolean;
    /** The link it was imported from. */
    url: string;
    /** The metadata provider that recognised the link. */
    platform?: string;
    /** The album, playlist or group it belongs to. */
    parentId?: string;
    /** The compiled metadata (sources + the user's overrides), as it would be written into the file. */
    title?: string;
    artists: readonly string[];
    album?: string;
    isrc?: string;
    durationMs?: number;
    year?: number;
    trackNumber?: number;
    genres: readonly string[];
    /** Every compiled field as the app shows it ("—" when missing), keyed by field. */
    fields: Readonly<Record<string, string>>;
    /** The user's own overrides (what they typed over the sources). */
    overrides: Readonly<Record<string, unknown>>;
    sources: readonly SourceView[];
    downloads: readonly DownloadView[];
    savedFile?: SavedFileView;
    /** Saved stems, by kind ("vocals"): their paths. */
    stems: Readonly<Record<string, string>>;
}>;

export type CollectionView = Readonly<{
    id: string;
    kind: "collection";
    collectionKind: "album" | "playlist" | "group";
    state: string;
    status?: string;
    busy: boolean;
    /** "" for a group. */
    url: string;
    platform?: string;
    name?: string;
    childIds: readonly string[];
}>;

export type TaskView = TrackView | CollectionView;

export type TaskFilter = {
    kind?: "track" | "collection";
    /** pending · running · finished · failed · stopped */
    state?: string;
    /** Only the tracks of this album, playlist or group. */
    parentId?: string;
    /** Only the tracks that have a saved file (true) or none (false). */
    saved?: boolean;
    /** Matched against title, artists, album and the link, ignoring case. */
    query?: string;
};

/** Changes one track, through the same named methods (and checks) as the panels. Each refuses a busy task, or one Claude holds. */
export interface TrackEditor {
    readonly id: string;
    /** Sets fields of the metadata written to the file (`null` clears an override): `{ trackName: "…", artists: ["A", "B"], year: 2001 }`. Validated like typing in the panel. */
    patchMetadata(patch: Record<string, unknown>): Promise<TrackView>;
    /** Track links of other platforms, pasted onto the track (kept across restarts, like the user's own). */
    addSources(urls: string[]): Promise<{ added: string[]; skipped: { url: string; reason: string }[] }>;
    /** Removes a link the user (or an extension) added. `url` as it was given. */
    removeSource(url: string): Promise<boolean>;
    /** Picks the download the track is saved from. */
    selectDownload(downloadId: string): Promise<TrackView>;
    rejectDownload(downloadId: string, rejected: boolean): Promise<TrackView>;
    /** Folder / file name this track is saved under (undefined: Settings' own). */
    setOutput(options: { dir?: string | null; fileName?: string | null }): Promise<TrackView>;
    /** Which stages a run does. */
    setRunFlags(flags: { fetchMetadata?: boolean; download?: boolean }): Promise<TrackView>;
    /** Saves (tags + moves) the selected download, as "Save" does. */
    save(): Promise<TrackView>;
    /** Re-runs discovery (one provider by key, or all). */
    rediscover(provider?: string): Promise<TrackView>;
    /** Re-runs the downloads. */
    redownload(): Promise<TrackView>;
    /** Starts a stem separation (Settings → Stems must be set up). Resolves when it has ended. */
    separateStems(options?: { model?: string }): Promise<TrackView>;
}

export interface ExtensionTasks {
    /** Every task in list order (frozen views), optionally filtered. */
    list(filter?: TaskFilter): TaskView[];
    get(id: string): TaskView | undefined;
    /** The tasks the user has selected in the list (or the one under the cursor). */
    selected(): TaskView[];
    /** Called (at most once per frame) after any task changed. Returns the function that stops it. */
    onChange(listener: () => void): () => void;
    /** Adds links as tasks, like pasting them (short links are followed first). Not started unless `start`. */
    add(
        urls: string[],
        options?: { fetchMetadata?: boolean; download?: boolean; start?: boolean }
    ): Promise<{ added: string[]; skipped: { url: string; reason: string }[] }>;
    /**
     * Removes tasks from the list for good, like Delete (busy ones are left; an album goes whole). Asks the user first
     * unless `confirm: false`. Resolves with the ids removed.
     */
    remove(ids: string[], options?: { confirm?: boolean; reason?: string }): Promise<string[]>;
    /** Moves tasks to the archive (reversible, no question). Resolves with how many. */
    archive(ids: string[]): Promise<number>;
    /** Starts these tasks, like Run selected. Resolves with why nothing started, or undefined. */
    run(ids: string[]): Promise<string | undefined>;
    /** Stops every run (like Stop), or the runs of these tasks only. */
    stop(ids?: string[]): Promise<void>;
    /** A track to change. Throws when there is no track with this id. */
    edit(id: string): TrackEditor;
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExtensionEvents {
    /** The first render is done and the session is loaded. */
    "app.ready": Record<string, never>;
    /** Before the app quits (a short time limit: about 2 s). */
    "app.exit": Record<string, never>;
    /** The tagged file is in the output folder. */
    "track.saved": { track: TrackView; path: string; format: string };
    /** A run ended in error. */
    "track.failed": { track: TrackView; stage: "metadata" | "download" | "run"; message: string };
    /** Every track of an album / playlist / group is saved or failed. */
    "collection.done": { collection: CollectionView; saved: number; failed: number; total: number };
    /** Stem files were saved. */
    "stems.saved": { track: TrackView; stems: Readonly<Record<string, string>> };
    /** Tasks were added to the list (pasted, imported, by Claude or an extension). */
    "tasks.added": { ids: readonly string[] };
}

export type ExtensionEventName = keyof ExtensionEvents;

export type ExtensionEventHandler<K extends ExtensionEventName> = (
    payload: ExtensionEvents[K],
    ctx: { signal: AbortSignal; event: K }
) => void | Promise<void>;

// ── Actions, tools, providers ────────────────────────────────────────────────────────────────────────────────────

export interface ExtensionAction {
    /** Local id; stored as `<extension>.<id>`. */
    id: string;
    label: string;
    description: string;
    /** Why it cannot be used now (greys the item), or undefined. Called each time the menu opens: keep it fast (< 50 ms). */
    unavailableReason?: () => string | undefined;
    /** Runs after the menu closed. A throw is logged with the extension's name. */
    run: () => void | Promise<void>;
}

/** A tool Claude can call in the chat. Same declaration as the app's own tools (docs/agent-tools.md). */
export interface ExtensionToolDefinition<TInput = Record<string, unknown>> {
    /** snake_case; the tool is named `<extension_name>__<name>` (dashes become underscores). */
    name: string;
    summary: string;
    kind: "read" | "write" | "confirm";
    /** JSON Schema of the input object. */
    input: {
        type: "object";
        properties?: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
    };
    locks: "none" | "task" | "tasks";
    example?: Record<string, unknown>;
    run: (
        input: TInput,
        ctx: {
            signal: AbortSignal;
            /** Asks the user (safe button first); null when nobody answers or the turn ended. */
            confirm(dialog: ConfirmDialog): Promise<number | null>;
            /** Changes a track as Claude (checks the turn's budget, refuses a stale revision). */
            write<T extends object>(
                taskId: string,
                revision: number,
                label: string,
                change: (editor: TrackEditor) => Promise<T> | T
            ): Promise<T & { revision: number }>;
        }
    ) => unknown | Promise<unknown>;
}

/** An abstract class of the app (the base class to extend), as a value. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbstractClass<T> = abstract new (...args: any[]) => T;

export interface ProviderRegistryApi<T> {
    /** Registers a provider class (it must extend the base class `goblin` gave). Its key becomes `<extension>.<key>`. Returns that key. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    register(key: string, providerClass: new (...args: any[]) => T): string;
}

// ── Processes, files, Claude ─────────────────────────────────────────────────────────────────────────────────────

export type SpawnOptions = {
    cwd?: string;
    /** Added to the environment (which never holds the app's credentials). */
    env?: Record<string, string>;
    /** Written to the program's stdin, then closed. */
    input?: string;
    /** Stops the program (and the ones it started). */
    signal?: AbortSignal;
    /** Kills it after this long (default 10 minutes). */
    timeoutMs?: number;
};

export type SpawnResult = { code: number | null; signal: string | null; stdout: string; stderr: string };

export type AudioFileInfo = Readonly<{
    path: string;
    format: string;
    sizeBytes: number;
    /** The tags, by their Vorbis-comment name (TITLE, ARTIST, ISRC…), whatever the file's format. */
    tags: Readonly<Record<string, string | readonly string[]>>;
    /** Shorthands read from the tags. */
    title?: string;
    artists: readonly string[];
    album?: string;
    isrc?: string;
    /** From the file itself (ffprobe), when it could be read. */
    durationMs?: number;
}>;

export type ScanOptions = {
    /** Default: flac, mp3, m4a, ogg, opus, wav, aiff, aif, wma, alac. */
    extensions?: string[];
    /** Read the tags of each file (slower). Default true. */
    readTags?: boolean;
    /** Read each file's duration with ffprobe (slower still). Default false. */
    probeDuration?: boolean;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
};

export type ClaudeAskOptions = {
    /** JSON Schema the answer must satisfy (default: `{ answer: string }`). */
    schema?: object;
    /** System prompt. */
    system?: string;
    /** A Claude model alias ("haiku", "sonnet", "opus") or name. Default: the Claude provider's. */
    model?: string;
    /** Let Claude search the web (only when the user allowed the Claude provider). */
    webSearch?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
};

// ── The `goblin` object ──────────────────────────────────────────────────────────────────────────────────────────

export type LogFn = (message: string, details?: Record<string, unknown>) => void;

export interface GoblinApi {
    /** The API version of this app (an extension declares the one it needs in its manifest). */
    readonly apiVersion: number;
    /** The app's version. */
    readonly version: string;
    readonly extension: Readonly<{
        name: string;
        displayName: string;
        version: string;
        /** The extension's folder. */
        folder: string;
        /** A folder of its own for data it keeps (created on first use of `storage`). */
        dataDir: string;
        /** Loaded with `--extension <path>` (an author working on it), without the trust record. */
        development: boolean;
    }>;
    readonly paths: Readonly<{
        /** The app's data folder. */
        appData: string;
        /** Where tracks are saved (Settings → Download), read now. */
        outputDir(): string;
    }>;

    readonly log: { debug: LogFn; info: LogFn; warn: LogFn; error: LogFn };

    /** The extension's own settings (`settings.json`, under `extensions.<name>`), edited in Settings → Extensions. */
    readonly settings: {
        get<T = unknown>(key: string): T;
        all(): Record<string, unknown>;
        set(key: string, value: unknown): void;
        /** Declares (more) settings, as the manifest does. */
        declare(schema: ExtensionSettingsSchema): void;
        /** Called after any of its settings changed. */
        onChange(listener: (all: Record<string, unknown>) => void): () => void;
        /** Extra rows under its settings (an action, a note), built each time the settings are drawn: cheap, no disk. */
        rows(build: (status: string | undefined) => ProviderSettingsRow[]): void;
        /** A line read in the background when Settings opens (given to `rows` as `status`). */
        status(read: () => Promise<string | undefined>): void;
    };

    /** Credentials, its own keys only (kept in `.env` as `GOBLIN_EXT_<NAME>__<KEY>`). Never in the environment of a program the app starts. */
    readonly secrets: {
        get(key: string): string | undefined;
        set(key: string, value: string): void;
        delete(key: string): void;
    };

    /** A small JSON store of its own (a file in `dataDir`), written in the background. */
    readonly storage: {
        get<T = unknown>(key: string): Promise<T | undefined>;
        set(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<void>;
    };

    /** Items of the toolbar's Actions menu. */
    readonly actions: { register(action: ExtensionAction): void };

    /** Asking the user. Every call answers null when it is dismissed or nobody can answer. */
    readonly dialog: {
        confirm(dialog: ConfirmDialog, options?: { signal?: AbortSignal }): Promise<number | null>;
        choose(dialog: ListDialog): Promise<ListAnswer>;
        input(dialog: InputDialog): Promise<string | null>;
        matrix(dialog: MatrixDialog): Promise<MatrixAnswer>;
        /** A message with one OK button. */
        notify(title: string, message: string): Promise<void>;
    };

    readonly tasks: ExtensionTasks;

    /** Listens to an event. Handlers run after the fact, async, with a time limit (default 30 s, up to 10 min). */
    on<K extends ExtensionEventName>(
        event: K,
        handler: ExtensionEventHandler<K>,
        options?: { timeoutMs?: number }
    ): () => void;

    /** Runs a program: the app's credentials are not in its environment, it is killed with the app, and on `signal`. */
    spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnResult>;

    /** `fetch` with a time limit (default 30 s; `timeoutMs` in the init). */
    fetch(url: string | URL, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;

    readonly files: {
        /** The tags of an audio file, read with the app's own readers. */
        readTags(path: string): Promise<AudioFileInfo>;
        /** Every audio file under a folder (recursively), with its tags. */
        scanAudio(folder: string, options?: ScanOptions): Promise<AudioFileInfo[]>;
    };

    readonly clipboard: { read(): Promise<string>; write(text: string): Promise<void> };

    /** Opens a link in the browser (or its desktop app). */
    open(url: string): boolean;
    /** Shows a file in the system's file manager. */
    reveal(path: string): void;

    /** One question to Claude (the user's CLI, no tools). Asks the user first, once (the Claude provider's consent); null when refused. */
    readonly claude: {
        ask<T = { answer: string }>(prompt: string, options?: ClaudeAskOptions): Promise<T | null>;
    };

    /** Tools for the chat with Claude. */
    readonly agent: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defineTool<TInput = any>(tool: ExtensionToolDefinition<TInput>): string;
    };

    /** Registers providers (keys prefixed with the extension's name). */
    readonly providers: {
        metadata: ProviderRegistryApi<MetadataService>;
        discovery: ProviderRegistryApi<DiscoveryMetadataService>;
        download: ProviderRegistryApi<DownloadService>;
        stems: ProviderRegistryApi<StemSeparationService>;
        /** The full key of one of its providers (`<extension>.<key>`): what its track metadata's `platform` must say. */
        keyOf(localKey: string): string;
    };

    /** The base classes to extend (the app's own: `instanceof` checks pass). */
    readonly MetadataService: AbstractClass<MetadataService> & typeof MetadataService;
    readonly DiscoveryMetadataService: AbstractClass<DiscoveryMetadataService> & typeof DiscoveryMetadataService;
    readonly DownloadService: AbstractClass<DownloadService> & typeof DownloadService;
    readonly StemSeparationService: AbstractClass<StemSeparationService> & typeof StemSeparationService;
}

/** What `activate` may return: a `dispose()` called when the app closes (directly, or as `{ dispose }`). */
export type ActivateResult = void | (() => void | Promise<void>) | { dispose?: () => void | Promise<void> };

/** The extension's entry point: `export default function activate(goblin) { … }`. */
export type Activate = (goblin: GoblinApi) => ActivateResult | Promise<ActivateResult>;
