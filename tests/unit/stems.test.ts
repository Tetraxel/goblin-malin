import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { SeparateRequest, StemModel } from "#flows/musicDownloadFlow/stems/stemService";
import type { StemRun, TrackDownloadTask } from "#flows/musicDownloadFlow/types";
import {
    SeparatorProgress,
    parseSeparatorLine,
    parseUvLine,
    stemFromOutputName,
} from "#flows/musicDownloadFlow/services/stem-providers/audioSeparator/progress";
import { computeStemPath, isStemRunStale, pickedStem, stemCellState } from "#flows/musicDownloadFlow/stems/stemFiles";
import { sortStemKinds, stemSetKinds } from "#flows/musicDownloadFlow/stems/stemKinds";
import { localFilePaths, markMissingInAttributes } from "#flows/musicDownloadFlow/utils/missingLocalFiles";

// Anything that touches app data (settings, sessions, logs) must point at a temp dir first, hence the dynamic imports.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-stems-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;
const tempDir = path.join(dataDir, "tmp");
const libraryDir = path.join(dataDir, "library");

// Probing a stem would download ffprobe: the fake files are not audio anyway.
vi.mock("#flows/musicDownloadFlow/utils/readFileInfo", () => ({
    readFileInfo: async () => ({ format: "flac", sizeBytes: 4, durationMs: 1000, embeddedTags: {} }),
}));

describe("reading audio-separator's output (P33 spike, 0.48.0)", () => {
    test("a model download, a separation pass and a log line are told apart", () => {
        expect(parseSeparatorLine(" 54%|#####4    | 45.6M/84.1M [00:00<00:00, 54.1MiB/s]")).toEqual({
            kind: "download",
            fraction: 0.54,
        });
        expect(parseSeparatorLine(" 67%|######6   | 24/36 [00:02<00:01,  9.88it/s]")).toEqual({
            kind: "pass",
            fraction: 0.67,
        });
        expect(parseSeparatorLine("100%|##########| 36/36 [00:03<00:00, 10.06it/s]")).toEqual({
            kind: "pass",
            fraction: 1,
        });
        expect(
            parseSeparatorLine("2026-11-23 02:59:44.568 - INFO - separator - Loading model htdemucs_ft.yaml...")
        ).toEqual({ kind: "log", level: "INFO", message: "Loading model htdemucs_ft.yaml..." });
        expect(parseSeparatorLine("ModuleNotFoundError: No module named 'audioread'")).toEqual({
            kind: "exception",
            message: "ModuleNotFoundError: No module named 'audioread'",
        });
        expect(parseSeparatorLine("Skip loading CUDA and cuDNN DLLs since torch is imported.")).toBeNull();
    });

    test("passes are counted, and the last error is kept for a failed run's message", () => {
        const progress = new SeparatorProgress();
        expect(progress.feed("2026-11-23 02:59:44.568 - INFO - separator - Loading model x.yaml...")).toEqual({
            text: "Loading the model",
        });
        expect(progress.feed("  0%|          | 0/36 [00:00<?, ?it/s]")?.text).toBe("Separating · pass 1");
        expect(progress.feed("100%|##########| 36/36 [00:03<00:00, 10.06it/s]")?.text).toBe("Separating · pass 1");
        expect(progress.feed(" 50%|#####     | 18/36 [00:01<00:01, 9.9it/s]")).toEqual({
            text: "Separating · pass 2",
            fraction: 0.5,
        });
        progress.feed("2026-11-23 03:01:45.984 - ERROR - separator - FFmpeg is not installed.");
        expect(progress.error()).toBe("FFmpeg is not installed.");
    });

    test("a stem is read from the program's own file name, even when the input has parentheses", () => {
        expect(stemFromOutputName("input_(Vocals)_htdemucs_ft.flac")).toBe("vocals");
        expect(stemFromOutputName("Song (Live) [2020]_(No Drums)_model.flac")).toBe("no drums");
        expect(stemFromOutputName("download_checks.json")).toBeNull();
    });

    test("uv's install steps are shown, its other lines are not", () => {
        expect(parseUvLine("Downloading torch (2.3GiB)")).toEqual({ text: "Downloading torch (2.3GiB)" });
        expect(parseUvLine(" + torch==2.15.0+cu132")).toBeNull();
    });
});

describe("the audio-separator model list", () => {
    test("is flattened into models with lower-case stems and the files a download leaves", async () => {
        const { parseModelList } =
            await import("#flows/musicDownloadFlow/services/stem-providers/audioSeparator/engine");
        const models = parseModelList({
            Demucs: {
                "Demucs v4: htdemucs_ft": {
                    filename: "htdemucs_ft.yaml",
                    stems: ["vocals", "drums", "bass", "other"],
                    download_files: [
                        "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/f7e0c4bc-ba3fe64a.th",
                        "htdemucs_ft.yaml",
                    ],
                },
            },
            MDXC: { "Roformer Model: BS Roformer SW": { filename: "BS-Roformer-SW.ckpt", stems: [] } },
        });
        expect(models).toEqual([
            {
                id: "htdemucs_ft.yaml",
                label: "Demucs v4: htdemucs_ft",
                family: "Demucs",
                stems: ["vocals", "drums", "bass", "other"],
                files: ["f7e0c4bc-ba3fe64a.th", "htdemucs_ft.yaml"],
            },
            {
                id: "BS-Roformer-SW.ckpt",
                label: "Roformer Model: BS Roformer SW",
                family: "MDXC",
                stems: [],
                files: ["BS-Roformer-SW.ckpt"],
            },
        ]);
    });
});

const run = (over: Partial<StemRun> & { id: string }): StemRun => ({
    provider: "fake",
    model: "m1",
    input: { path: "/music/a.flac", kind: "saved", fingerprint: "1:1" },
    state: "done",
    startedAt: new Date(0),
    stems: [],
    ...over,
});
const stem = (kind: string, file: string, state: "found" | "not_found" = "found") => ({ kind, path: file, state });

describe("stem files and states", () => {
    test("a stem is saved next to the track, named after it by the template", () => {
        const parent = path.join("music", "Artist - Title.flac");
        expect(computeStemPath(parent, "vocals", "{name} ({Stem})", "flac")).toBe(
            path.join("music", "Artist - Title (Vocals).flac")
        );
        expect(computeStemPath(parent, "drums", "Stems/{name} - {stem}", "mp3")).toBe(
            path.join("music", "Stems", "Artist - Title - drums.mp3")
        );
        // A template without the stem would give every stem the same name: the default one is used.
        expect(computeStemPath(parent, "bass", "{name}", "flac")).toBe(
            path.join("music", "Artist - Title (Bass).flac")
        );
        // No way out of the track's folder.
        expect(computeStemPath(parent, "bass", "../../{name} {stem}", "flac")).toBe(
            path.join("music", "Artist - Title bass.flac")
        );
    });

    test("each stem uses the run the user picked, else the newest finished run that has it", () => {
        const attrs = {
            stemRuns: [
                run({ id: "r1", stems: [stem("vocals", "/t/1v"), stem("drums", "/t/1d")] }),
                run({ id: "r2", stems: [stem("vocals", "/t/2v")] }),
                run({ id: "r3", state: "failed", stems: [] }),
            ],
            stemPick: { vocals: "r1" },
        };
        expect(pickedStem(attrs, "vocals")?.run.id).toBe("r1");
        expect(pickedStem(attrs, "drums")?.run.id).toBe("r1");
        expect(pickedStem({ ...attrs, stemPick: {} }, "vocals")?.run.id).toBe("r2");
        // A pick of a run that is gone falls back to the newest.
        expect(pickedStem({ ...attrs, stemPick: { vocals: "gone" } }, "vocals")?.run.id).toBe("r2");
    });

    test("the cell of a stem: saved wins, then a run in progress, then the separated file, then a failure", () => {
        const saved = {
            kind: "vocals",
            path: "/music/a (Vocals).flac",
            writtenPath: "/music/a (Vocals).flac",
            savedAt: new Date(0),
            runId: "r1",
            model: "m1",
            parentPath: "/music/a.flac",
        };
        const base = {
            savedFile: { path: "/music/a.flac" } as TrackDownloadTask["savedFile"],
            stemRuns: [run({ id: "r1", stems: [stem("vocals", "/t/v"), stem("drums", "/t/d", "not_found")] })],
        };
        expect(stemCellState({ ...base, savedStems: { vocals: saved } }, "vocals")).toEqual({
            state: "saved",
            path: saved.path,
            follows: true,
        });
        expect(
            stemCellState(
                {
                    ...base,
                    savedFile: { path: "/music/b.flac" } as TrackDownloadTask["savedFile"],
                    savedStems: { vocals: saved },
                },
                "vocals"
            )
        ).toMatchObject({ state: "saved", follows: false });
        expect(stemCellState(base, "vocals")).toEqual({ state: "temp", path: "/t/v", runId: "r1" });
        expect(stemCellState(base, "drums")).toEqual({ state: "tempMissing", path: "/t/d", runId: "r1" });
        expect(stemCellState(base, "bass")).toEqual({ state: "none" });
        expect(
            stemCellState(
                { stemRuns: [...base.stemRuns, run({ id: "r2", state: "separating", progress: 0.4 })] },
                "vocals"
            )
        ).toMatchObject({ state: "separating", progress: 0.4 });
        expect(stemCellState({ stemRuns: [run({ id: "r9", state: "failed", error: "boom" })] }, "bass")).toEqual({
            state: "failed",
            error: "boom",
        });
    });

    test("a run is stale when the track's file was replaced since", () => {
        const r = run({ id: "r1" });
        expect(isStemRunStale(r, "1:1", "/music/a.flac")).toBe(false);
        expect(isStemRunStale(r, "2:5", "/music/a.flac")).toBe(true);
        expect(isStemRunStale(r, "1:1", "/music/b.flac")).toBe(true);
    });

    test("the stem set orders the columns; other stems come after, by name", () => {
        expect(stemSetKinds("4 stems")).toEqual(["vocals", "drums", "bass", "other"]);
        expect(stemSetKinds("nonsense")).toEqual(["vocals", "drums", "bass", "other"]);
        expect(sortStemKinds(["piano", "other", "vocals", "guitar"], stemSetKinds("4 stems"))).toEqual([
            "vocals",
            "other",
            "guitar",
            "piano",
        ]);
    });

    test("temporary stems count as files in use, and are marked when they are gone", () => {
        const attrs = {
            downloadSources: [{ localFile: { state: "found", path: "/t/dl.flac" } }],
            stemRuns: [run({ id: "r1", stems: [stem("vocals", "/t/v.flac"), stem("drums", "/t/d.flac")] })],
        };
        expect(localFilePaths(attrs)).toEqual(["/t/dl.flac", "/t/v.flac", "/t/d.flac"]);
        const marked = markMissingInAttributes(attrs, (p) => p === "/t/d.flac");
        expect(marked.stemRuns[0].stems.map((s) => s.state)).toEqual(["found", "not_found"]);
        expect(marked.downloadSources).toBe(attrs.downloadSources);
        // Nothing gone: the very same object.
        expect(markMissingInAttributes(attrs, () => false)).toBe(attrs);
    });

    test("a run saved while it was separating comes back stopped, with its dates", async () => {
        const { reviveTaskDates } = await import("#flows/musicDownloadFlow/utils/reviveTaskDates");
        const raw = JSON.parse(
            JSON.stringify({
                kind: "track",
                state: "finished",
                userInput: { type: "url", url: "x" },
                metadataGroups: [],
                metadataOverride: {},
                downloadSources: [],
                stemRuns: [run({ id: "r1", state: "separating", progress: 0.5 })],
                savedStems: {
                    vocals: {
                        kind: "vocals",
                        path: "/a",
                        writtenPath: "/a",
                        savedAt: new Date(5),
                        runId: "r1",
                        model: "m",
                    },
                },
            })
        );
        const revived = reviveTaskDates(raw) as TrackDownloadTask;
        expect(revived.stemRuns?.[0]).toMatchObject({ state: "stopped", progress: undefined });
        expect(revived.stemRuns?.[0].startedAt).toBeInstanceOf(Date);
        expect(revived.savedStems?.vocals.savedAt).toBeInstanceOf(Date);
    });
});

// ── A track separated by a fake provider (no Python, no network) ──────────────────────────────────────────────

type Gate = { release: () => void; promise: Promise<void> };
const gate = (): Gate => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { release, promise };
};

let models: StemModel[];
let separateGate: Gate | undefined;
let separateCalls: Omit<SeparateRequest, "logger">[];

type Mods = {
    DownloadTask: typeof DownloadTaskType;
    ServiceRegistry: typeof import("#base/service-registry").ServiceRegistry;
    settings: import("#settings/settingsStore").SettingsStore;
};
let m: Mods;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    const { StemSeparationService } = await import("#flows/musicDownloadFlow/stems/stemService");
    const { stemServiceRegistry } = await import("#flows/musicDownloadFlow/registries");

    const engine = {
        status: async () => ({ installed: true, version: "test", build: "cpu" as const }),
        installedBuild: async () => "cpu" as const,
        detectGpu: async () => undefined,
        install: async () => {},
        uninstall: async () => {},
        listModels: async () => models,
        downloadModel: async () => {},
        removeModel: async () => {},
        separate: async () => [],
    };
    class FakeStems extends StemSeparationService {
        static readonly defaultSettings = {
            enabled: { label: "Enable", defaultValue: false, kind: "checkbox" as const },
        };
        static readonly engine = engine;
        static readonly defaultModel = "m1";
        constructor(task: DownloadTaskType, logger: never) {
            super("fakeStems", task, logger);
        }
        async separate(request: Omit<SeparateRequest, "logger">) {
            separateCalls.push(request);
            request.onProgress({ text: "Separating", fraction: 0.5 });
            if (separateGate) {
                await Promise.race([
                    separateGate.promise,
                    new Promise((_, reject) =>
                        request.signal.addEventListener("abort", () =>
                            reject(new DOMException("Stopped", "AbortError"))
                        )
                    ),
                ]);
            }
            return ["vocals", "drums"].map((kind) => {
                const file = path.join(request.outDir, `${request.baseName}.${kind}.flac`);
                fs.writeFileSync(file, kind);
                return { kind, path: file };
            });
        }
    }
    if (!stemServiceRegistry.getConstructor("fakeStems")) stemServiceRegistry.register("fakeStems", FakeStems as never);

    const { SettingsStore } = await import("#settings/settingsStore");
    m = {
        DownloadTask: (await import("#flows/musicDownloadFlow/utils/downloadTask")).DownloadTask,
        ServiceRegistry: (await import("#base/service-registry")).ServiceRegistry,
        settings: SettingsStore.getInstance(),
    };
    m.settings.patchMusicSettings({
        musicBrainz: { matchTracks: false },
        download: { outputTemporaryDir: tempDir, convertAudio: true, convertFormat: "flac" },
        stems: { tagStems: false, saveWithTrack: true, providers: { fakeStems: { enabled: true } } },
    });
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

beforeEach(() => {
    models = [{ id: "m1", label: "Model One", family: "Test", stems: ["vocals", "drums"], downloaded: true }];
    separateGate = undefined;
    separateCalls = [];
    fs.mkdirSync(libraryDir, { recursive: true });
    m.settings.patchMusicSettings({ stems: { providers: { fakeStems: { enabled: true } } } });
});

async function savedTrack(name = "Artist - Title"): Promise<DownloadTaskType> {
    const parent = path.join(libraryDir, `${name}.flac`);
    fs.writeFileSync(parent, "audio");
    const { globalLogger } = await import("#base/logger/logger");
    const attrs: TrackDownloadTask = {
        kind: "track",
        state: "finished",
        userInput: { type: "url", url: "https://example.test/1" },
        metadataGroups: [],
        metadataOverride: { trackName: "Title", artists: [{ type: "artist", name: "Artist" }] } as never,
        downloadSources: [],
        savedFile: {
            path: parent,
            writtenPath: parent,
            savedAt: new Date(),
            provider: "ytdlp",
            track: {} as never,
        },
    };
    return new m.DownloadTask({
        id: `t-${name}`,
        initialInput: "https://example.test/1",
        attributes: attrs,
        logger: globalLogger,
        metadataServiceRegistry: new m.ServiceRegistry(),
        discoveryServiceRegistry: new m.ServiceRegistry(),
        downloadServiceRegistry: new m.ServiceRegistry(),
        isMetadataServiceEnabled: () => true,
        isDiscoveryServiceEnabled: () => true,
        isDownloadServiceEnabled: () => true,
    } as never);
}

describe("separating a track's stems", () => {
    test("a run reads the saved file, keeps the task busy while it separates, and lists its stems", async () => {
        separateGate = gate();
        const task = await savedTrack();
        const { run: started, done } = await task.startStemSeparation();
        expect(started).toMatchObject({
            model: "m1",
            modelLabel: "Model One",
            device: "cpu",
            input: { kind: "saved" },
        });
        await vi.waitFor(() => expect(separateCalls).toHaveLength(1));
        expect(task.isBusy()).toBe(true);
        expect(separateCalls[0].input).toBe(task.getAttributes()?.savedFile?.path);
        // The temp files carry the app's temp signature (a uuid): "clear temporary downloads" knows them.
        expect(separateCalls[0].baseName).toMatch(/ [0-9a-f-]{36}$/);

        separateGate.release();
        await done;
        expect(task.isBusy()).toBe(false);
        const runs = task.getAttributes()?.stemRuns ?? [];
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ state: "done", progress: undefined });
        expect(runs[0].stems.map((s) => s.kind)).toEqual(["vocals", "drums"]);
    });

    test("Stop (the task's own stop) ends the run as stopped, and the task is free again", async () => {
        separateGate = gate();
        const task = await savedTrack();
        const { done } = await task.startStemSeparation();
        await vi.waitFor(() => expect(separateCalls).toHaveLength(1));
        task.abortRun();
        await done;
        expect(task.getAttributes()?.stemRuns?.[0].state).toBe("stopped");
        expect(task.isBusy()).toBe(false);
    });

    test("it is refused, with the reason, when stem separation is off or the model is not downloaded", async () => {
        const task = await savedTrack();
        models = [{ ...models[0], downloaded: false }];
        await expect(task.startStemSeparation()).rejects.toThrow(/not downloaded/);
        m.settings.patchMusicSettings({ stems: { providers: { fakeStems: { enabled: false } } } });
        await expect(task.startStemSeparation()).rejects.toThrow(/off/);
        expect(task.getAttributes()?.stemRuns ?? []).toHaveLength(0);
    });

    test("stems are saved next to the track, and a restart of the track keeps every run, pick and saved stem", async () => {
        const task = await savedTrack("Keep Me");
        const { run: first, done } = await task.startStemSeparation();
        await done;
        task.pickStem("vocals", first.id);
        const saved = await task.saveStems();
        expect(saved.sort()).toEqual(["drums", "vocals"]);
        const vocals = task.getAttributes()?.savedStems?.vocals;
        expect(vocals?.path).toBe(path.join(libraryDir, "Keep Me (Vocals).flac"));
        expect(fs.readFileSync(vocals!.path, "utf8")).toBe("vocals");

        task.resetForRerun();
        const after = task.getAttributes()!;
        expect(after.stemRuns?.map((r) => r.id)).toEqual([first.id]);
        expect(after.stemPick).toEqual({ vocals: first.id });
        expect(Object.keys(after.savedStems ?? {}).sort()).toEqual(["drums", "vocals"]);
    });

    test("deleting a run deletes its temporary files and its picks, never the saved stems", async () => {
        const task = await savedTrack("Delete Run");
        const { run: r, done } = await task.startStemSeparation();
        await done;
        await task.saveStems(["vocals"]);
        task.pickStem("drums", r.id);
        const temp = task.getAttributes()!.stemRuns![0].stems.map((s) => s.path);
        await task.deleteStemRun(r.id);
        expect(task.getAttributes()?.stemRuns).toEqual([]);
        expect(task.getAttributes()?.stemPick).toEqual({});
        for (const file of temp) expect(fs.existsSync(file)).toBe(false);
        expect(fs.existsSync(task.getAttributes()!.savedStems!.vocals.path)).toBe(true);
    });

    test("a pick must name a finished run that has that stem", async () => {
        const task = await savedTrack("Pick");
        const { run: r, done } = await task.startStemSeparation();
        await done;
        expect(() => task.pickStem("bass", r.id)).toThrow(/no bass stem/);
        expect(() => task.pickStem("vocals", "nope")).toThrow(/No stem run/);
    });

    test("saving the stems needs the track to be saved: they are named after its file", async () => {
        const task = await savedTrack("Unsaved");
        const { done } = await task.startStemSeparation();
        await done;
        task.updateAttributes({ savedFile: undefined });
        await expect(task.saveStems()).rejects.toThrow(/Save the track first/);
    });
});

describe("the install progress, read from uv's lines (P33 measurement: 16 downloads, 2.29 GB)", () => {
    test("finished downloads count at their size; the one still going is estimated, never past 95 %", async () => {
        const { UvInstallProgress } =
            await import("#flows/musicDownloadFlow/services/stem-providers/audioSeparator/progress");
        const p = new UvInstallProgress();
        expect(p.snapshot(0)).toEqual({ text: "Resolving the packages" });
        p.feed("Resolved 60 packages in 744ms", 0);
        p.feed("Downloading numpy (100.0MiB)", 1000);
        p.feed("Downloading torch (900.0MiB)", 1000);
        expect(p.snapshot(1000).fraction).toBe(0);
        // numpy done after 2 s: 50 MiB/s, so by 4 s about 150 MiB arrived in all.
        p.feed(" Downloaded numpy", 3000);
        const mid = p.snapshot(4000);
        expect(mid.text).toMatch(/^Downloading 1 of 2 packages · about .* of 1\.0 GB · torch/);
        expect(mid.fraction).toBeCloseTo((150 / 1000) * 0.9, 2);
        // Long after: capped below the end while torch is not done.
        expect(p.snapshot(600_000).fraction).toBeCloseTo(((100 + 900 * 0.95) / 1000) * 0.9, 2);
        p.feed(" Downloaded torch", 30_000);
        expect(p.snapshot(30_000)).toMatchObject({ fraction: 0.9 });
        p.feed("Prepared 60 packages in 27.77s", 31_000);
        expect(p.snapshot(31_000)).toEqual({ text: "Installing the packages", fraction: 0.9 });
        p.feed("Installed 60 packages in 7.38s", 38_000);
        expect(p.snapshot(38_000).fraction).toBe(0.98);
    });

    test("sizes are read in uv's units", async () => {
        const { parseUvSize } =
            await import("#flows/musicDownloadFlow/services/stem-providers/audioSeparator/progress");
        expect(parseUvSize("2.0GiB")).toBe(2 * 1024 ** 3);
        expect(parseUvSize("150.5MiB")).toBe(150.5 * 1024 ** 2);
        expect(parseUvSize("download")).toBeUndefined();
    });
});

describe("choosing a stem model", () => {
    test("the recommended models come first, then the other 4-stem ones", async () => {
        const { sortModels } =
            await import("#flows/musicDownloadFlow/services/stem-providers/audioSeparator/settingsRows");
        const model = (id: string, stems: string[]) => ({ id, label: id, family: "x", stems, downloaded: false });
        const sorted = sortModels([
            model("a_vocals.onnx", ["vocals", "instrumental"]),
            model("hdemucs_mmi.yaml", ["vocals", "drums", "bass", "other"]),
            model("BS-Roformer-SW.ckpt", []),
            model("htdemucs_ft.yaml", ["vocals", "drums", "bass", "other"]),
        ]);
        expect(sorted.map((m) => m.id)).toEqual([
            "htdemucs_ft.yaml",
            "BS-Roformer-SW.ckpt",
            "hdemucs_mmi.yaml",
            "a_vocals.onnx",
        ]);
    });

    test("the list's search keeps the items holding every word, in the label or the details, accents ignored", async () => {
        const { filterListItems } = await import("#components/ListDialogModal/filterListItems");
        const items = [
            { label: "Demucs v4: htdemucs_ft", detail: ["Demucs · Vocals, Drums, Bass, Other"] },
            { label: "Roformer Model: BS Roformer SW", detail: ["MDXC · stems not listed"] },
            { label: "MDX-Net: Kim Vocal 2", detail: ["MDX · Vocals, Instrumental"] },
        ];
        expect(filterListItems(items, "")).toEqual([0, 1, 2]);
        expect(filterListItems(items, "drums")).toEqual([0]);
        expect(filterListItems(items, "VOCALS mdx")).toEqual([2]);
        expect(filterListItems(items, "démucs")).toEqual([0]);
        expect(filterListItems(items, "nothing")).toEqual([]);
    });
});

describe("the stem player's layers and waveforms", () => {
    test("the track first, then each stem of the set (empty until it has a file), then any other stem", async () => {
        const { stemLayers } = await import("#flows/musicDownloadFlow/stems/stemFiles");
        const layers = stemLayers(
            {
                stemRuns: [
                    run({
                        id: "r1",
                        stems: [stem("vocals", "/t/v"), stem("guitar", "/t/g"), stem("bass", "/t/b", "not_found")],
                    }),
                ],
                savedStems: {
                    drums: {
                        kind: "drums",
                        path: "/m/d.flac",
                        writtenPath: "/m/d.flac",
                        savedAt: new Date(0),
                        runId: "r0",
                        model: "m",
                    },
                },
            },
            ["vocals", "drums", "bass", "other"],
            { path: "/m/track.flac", durationMs: 1000 }
        );
        expect(layers.map((l) => [l.key, l.path])).toEqual([
            ["original", "/m/track.flac"],
            ["vocals", "/t/v"],
            ["drums", "/m/d.flac"],
            ["bass", undefined],
            ["other", undefined],
            ["guitar", "/t/g"],
        ]);
    });

    test("levels are the loudness (RMS) of each slice, scaled to the loudest; cells are blocks of that height", async () => {
        const { peaksOf } = await import("#flows/musicDownloadFlow/utils/waveform");
        const { waveformCells } = await import("#components/SecondaryPanel/StemsPanel/waveformCells");
        // RMS of each pair: 70.7, 316.2, 0, 50 → scaled to the loudest.
        const levels = peaksOf(new Int16Array([0, 100, -400, 200, 0, 0, 50, -50]), 4);
        expect(levels.map((l) => Math.round(l * 1000) / 1000)).toEqual([0.224, 1, 0, 0.158]);
        expect(peaksOf(new Int16Array([]), 3)).toEqual([0, 0, 0]);
        // Silence is a space; anything else at least the lowest block.
        expect(waveformCells([0, 0.05, 0.5, 1], 4)).toBe(" ▁▄█");
        // Several slices under one cell: the loudest of them.
        expect(waveformCells([0.1, 1, 0, 0], 2)).toBe("█ ");
    });
});

describe("the stem mixer", () => {
    test("by default the stems play and the track is muted; a solo plays only the soloed layers", async () => {
        const { gainsOf, isAudible } = await import("#flows/musicDownloadFlow/stems/stemMixer");
        const layers = [
            { key: "original", path: "/t.flac" },
            { key: "vocals", kind: "vocals", path: "/v.flac" },
            { key: "drums", kind: "drums", path: "/d.flac" },
            { key: "bass", kind: "bass" },
        ];
        const byDefault = { muted: new Set(["original"]), soloed: new Set<string>() };
        // Only layers with a file are in the mix: the bass has none yet.
        expect(gainsOf(byDefault, layers)).toEqual([0, 1, 1]);
        expect(gainsOf({ muted: new Set(["original", "drums"]), soloed: new Set() }, layers)).toEqual([0, 1, 0]);
        // A solo wins over the mutes, even of a muted layer (solo the track to hear it alone).
        expect(gainsOf({ muted: byDefault.muted, soloed: new Set(["original"]) }, layers)).toEqual([1, 0, 0]);
        expect(isAudible({ muted: new Set(), soloed: new Set(["vocals", "drums"]) }, "drums")).toBe(true);
    });

    test("the mix graph gives each file its gain and sums them without changing the level", async () => {
        const { buildGainGraph } = await import("#utils/mpvMixer");
        expect(buildGainGraph([1, 0])).toBe(
            "[aid1]volume=1.000[a0];[aid2]volume=0.000[a1];[a0][a1]amix=inputs=2:normalize=0[ao]"
        );
    });
});
