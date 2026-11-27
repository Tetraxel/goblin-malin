import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import * as fs from "fs";
import fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { DownloadTask as DownloadTaskType } from "#flows/musicDownloadFlow/utils/downloadTask";
import type { SavedFile, TrackDownloadSource, TrackMetadata } from "#flows/musicDownloadFlow/types";
import { StatusType } from "#base/task/task-status";

// `DownloadTask.saveTrack` decides what happens to the user's files: what is written first, what is deleted only
// once its replacement exists, what is left behind when a step fails. The audio work itself (tagging, ffmpeg) is
// replaced by fakes that leave a trace in the file, so what is tested is that order, on real files in a temp folder.

const hoisted = vi.hoisted(() => ({
    settings: { outputDir: "", includeMusicBrainzTags: false, convertAudio: false, convertFormat: "flac" },
    tagAudioFile: vi.fn(),
    convertAudioInto: vi.fn(),
}));

vi.mock("#flows/musicDownloadFlow/saveSettings", async (importOriginal) => ({
    ...(await importOriginal<typeof import("#flows/musicDownloadFlow/saveSettings")>()),
    getSaveSettings: () => ({ ...hoisted.settings }),
}));
vi.mock("#flows/musicDownloadFlow/utils/tagAudioFile", () => ({ tagAudioFile: hoisted.tagAudioFile }));
vi.mock("#flows/musicDownloadFlow/utils/convertAudio", () => ({ convertAudioInto: hoisted.convertAudioInto }));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goblin-save-track-test-"));
process.env.GOBLIN_DATA_DIR = dataDir;

const track = {
    id: "sp1",
    trackName: "Song",
    artists: [{ type: "artist", name: "Artist" }],
    duration: 200_000,
    url: "https://open.spotify.test/track/sp1",
    uri: "SPOTIFY::TRACK::sp1",
    platform: "spotify",
    apiProvider: "spotify",
    fetchedAt: new Date(),
    type: "track",
} as unknown as TrackMetadata;

type SaveModule = {
    DownloadTask: typeof DownloadTaskType;
    ServiceRegistry: typeof import("#base/service-registry").ServiceRegistry;
    overwriteConfirmBridge: typeof import("#base/bridges/overwriteConfirmBridge").overwriteConfirmBridge;
    dialogBridge: typeof import("#base/bridges/dialogBridge").dialogBridge;
};
let m: SaveModule;
let globalLogger: import("#base/logger/logger").Logger;

beforeAll(async () => {
    const { notificationScheduler } = await import("#base/notificationScheduler");
    notificationScheduler.setSyncMode(true);
    globalLogger = (await import("#base/logger/logger")).globalLogger;
    m = {
        DownloadTask: (await import("#flows/musicDownloadFlow/utils/downloadTask")).DownloadTask,
        ServiceRegistry: (await import("#base/service-registry")).ServiceRegistry,
        overwriteConfirmBridge: (await import("#base/bridges/overwriteConfirmBridge")).overwriteConfirmBridge,
        dialogBridge: (await import("#base/bridges/dialogBridge")).dialogBridge,
    };
});

afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

// ── a throw-away world for each test ──────────────────────────────────────────

let caseNumber = 0;
let outDir: string;
let tmpDir: string;
let elsewhereDir: string;
let confirmOverwrite: Mock<(file: string) => Promise<boolean>>;
let confirmDialog: Mock<() => Promise<number | null>>;

beforeEach(async () => {
    const root = path.join(dataDir, `case-${++caseNumber}`);
    outDir = path.join(root, "out");
    tmpDir = path.join(root, "tmp");
    elsewhereDir = path.join(root, "elsewhere");
    await fsp.mkdir(tmpDir, { recursive: true });
    await fsp.mkdir(elsewhereDir, { recursive: true });
    Object.assign(hoisted.settings, {
        outputDir: outDir,
        includeMusicBrainzTags: false,
        convertAudio: false,
        convertFormat: "flac",
    });
    // The fakes leave a trace in the file they were given, so a test can tell what was done to it.
    hoisted.tagAudioFile.mockReset();
    hoisted.tagAudioFile.mockImplementation(async (file: string) => {
        await fsp.appendFile(file, "|tagged");
    });
    hoisted.convertAudioInto.mockReset();
    hoisted.convertAudioInto.mockImplementation(async (from: string, to: string, format: string) => {
        await fsp.writeFile(to, `${await fsp.readFile(from, "utf8")}|as-${format}`);
    });
    confirmOverwrite = vi.fn(async () => true);
    m.overwriteConfirmBridge.setOpener((request) => {
        void confirmOverwrite(request.filePath).then((replace) => (replace ? request.replace() : request.cancel()));
    });
    confirmDialog = vi.fn(async () => 0);
    vi.spyOn(m.dialogBridge, "confirm").mockImplementation(() => confirmDialog());
});

afterEach(() => {
    vi.restoreAllMocks();
    m.overwriteConfirmBridge.setOpener(null);
});

// ── builders ──────────────────────────────────────────────────────────────────

const read = (file: string) => fsp.readFile(file, "utf8");
const exists = (file: string) =>
    fsp.access(file).then(
        () => true,
        () => false
    );
const outFiles = async () => ((await exists(outDir)) ? (await fsp.readdir(outDir)).sort() : []);

/** A finished download in the temp folder, and the row that shows it. */
async function download(name: string, content: string, selected = true): Promise<TrackDownloadSource> {
    const file = path.join(tmpDir, name);
    await fsp.writeFile(file, content);
    return {
        state: "downloaded",
        provider: "ytdlp",
        track,
        downloadedAt: new Date(),
        selected,
        localFile: { state: "found", path: file, name, extension: path.extname(name).slice(1) as never },
    };
}

/** The record of a file this app saved earlier, written at `file`. */
function savedAs(file: string, from?: TrackDownloadSource, extra: Partial<SavedFile> = {}): SavedFile {
    return {
        path: file,
        writtenPath: file,
        savedAt: new Date(2026, 0, 1),
        provider: "ytdlp",
        track,
        downloadPath: from?.localFile?.path,
        ...extra,
    };
}

function makeTask(sources: TrackDownloadSource[], savedFile?: SavedFile): DownloadTaskType {
    const unused = new m.ServiceRegistry<DownloadTaskType, never>();
    return new m.DownloadTask({
        id: `task-${caseNumber}-${Math.random()}`,
        initialInput: track.url,
        attributes: {
            kind: "track",
            state: "finished",
            userInput: { type: "url", url: track.url },
            metadataGroups: [
                {
                    platform: "spotify",
                    serviceKey: "spotify",
                    rank: 0,
                    results: [
                        {
                            metadata: track,
                            isPrimaryInput: true,
                            isFavorited: false,
                            isRejected: false,
                            rank: 0,
                            discoverySources: [],
                        },
                    ],
                },
            ],
            metadataOverride: {},
            downloadSources: sources,
            downloadsFetched: true,
            savedFile,
            toTag: true,
            toDownload: true,
        },
        logger: globalLogger,
        metadataServiceRegistry: unused,
        discoveryServiceRegistry: unused,
        downloadServiceRegistry: unused,
        isMetadataServiceEnabled: () => true,
        isDiscoveryServiceEnabled: () => true,
        isDownloadServiceEnabled: () => true,
    } as never);
}

const status = (task: DownloadTaskType) => task.getStatus().get();
const savedOf = (task: DownloadTaskType) => task.getAttributes()?.savedFile;

// ── a first save ──────────────────────────────────────────────────────────────

describe("saveTrack — a first save from a download", () => {
    test("writes the tagged file into the output folder, records it, and leaves the download alone", async () => {
        const source = await download("dl.flac", "AUDIO");
        const task = makeTask([source]);

        await task.saveTrack();

        const target = path.join(outDir, "Artist - Song.flac");
        expect(await read(target)).toBe("AUDIO|tagged");
        // Nothing but the finished file: the staging file it was built as is gone.
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
        expect(await read(source.localFile!.path)).toBe("AUDIO");

        // Tagged while it was still the staging file, with the track's metadata.
        const [taggedPath, tags] = hoisted.tagAudioFile.mock.calls[0];
        expect(path.basename(taggedPath)).toMatch(/^Artist - Song\.saving-[0-9a-f]+\.flac$/);
        expect(tags).toMatchObject({ trackTitle: "Song", artists: ["Artist"] });

        expect(savedOf(task)).toMatchObject({
            path: target,
            writtenPath: target,
            provider: "ytdlp",
            downloadPath: source.localFile!.path,
        });
        expect(savedOf(task)?.converted).toBeUndefined();
        expect(status(task)).toMatchObject({ type: StatusType.Success, message: "Saved" });
    });

    test("tells the extensions (track.saved) once the file is in place, with a view of the track", async () => {
        const { musicEvents } = await import("#flows/musicDownloadFlow/appEvents");
        const heard: { path: string; format: string; title?: string; saved?: string }[] = [];
        const off = musicEvents.on("track.saved", ({ track, path: file, format }) => {
            heard.push({ path: file, format, title: track.title, saved: track.savedFile?.path });
        });
        try {
            const task = makeTask([await download("dl.flac", "AUDIO")]);
            await task.saveTrack();
            await musicEvents.drain();
            const target = path.join(outDir, "Artist - Song.flac");
            expect(heard).toEqual([{ path: target, format: "flac", title: "Song", saved: target }]);
        } finally {
            off();
        }
    });

    test("with the tags switched off for this track, the file is copied as it came", async () => {
        const task = makeTask([await download("dl.flac", "AUDIO")]);
        task.setOverwriteTags(false);

        await task.saveTrack();

        expect(hoisted.tagAudioFile).not.toHaveBeenCalled();
        expect(await read(path.join(outDir, "Artist - Song.flac"))).toBe("AUDIO");
        // What was not written is not claimed as what the file holds.
        expect(savedOf(task)?.tags).toBeUndefined();
    });

    test("re-encodes into the chosen format, tags the result, and records what was really written", async () => {
        Object.assign(hoisted.settings, { convertAudio: true, convertFormat: "mp3" });
        const source = await download("dl.flac", "AUDIO");
        const task = makeTask([source]);

        await task.saveTrack();

        const target = path.join(outDir, "Artist - Song.mp3");
        expect(hoisted.convertAudioInto).toHaveBeenCalledWith(source.localFile!.path, expect.any(String), "mp3");
        expect(await read(target)).toBe("AUDIO|as-mp3|tagged");
        expect(await outFiles()).toEqual(["Artist - Song.mp3"]);
        expect(savedOf(task)?.converted).toEqual({ format: "mp3", sizeBytes: (await fsp.stat(target)).size });
    });

    test("refuses to save with nothing selected, or a selected download whose file is gone", async () => {
        const unselected = makeTask([await download("a.flac", "A", false)]);
        await expect(unselected.saveTrack()).rejects.toThrow("No download source selected");

        const lost = await download("b.flac", "B");
        lost.localFile = { ...lost.localFile!, state: "missing" } as never;
        await expect(makeTask([lost]).saveTrack()).rejects.toThrow("Local file not found");

        await expect(makeTask([await download("c.flac", "C")]).saveTrack({ fromSaved: true })).rejects.toThrow(
            "No saved file"
        );
        expect(await outFiles()).toEqual([]);
    });
});

// ── a step fails ──────────────────────────────────────────────────────────────

describe("saveTrack — when a step fails", () => {
    test("a tagging failure leaves no file at all (no half-made one, no staging leftover) and says so", async () => {
        hoisted.tagAudioFile.mockRejectedValue(new Error("not a valid FLAC"));
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        await expect(task.saveTrack()).rejects.toThrow("not a valid FLAC");

        expect(await outFiles()).toEqual([]);
        expect(savedOf(task)).toBeUndefined();
        expect(status(task)).toMatchObject({ type: StatusType.Error, message: "Save failed" });
    });

    test("a conversion failure leaves no file either", async () => {
        Object.assign(hoisted.settings, { convertAudio: true, convertFormat: "opus" });
        hoisted.convertAudioInto.mockRejectedValue(new Error("ffmpeg exited with code 1"));
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        await expect(task.saveTrack()).rejects.toThrow("ffmpeg");

        expect(await outFiles()).toEqual([]);
        expect(hoisted.tagAudioFile).not.toHaveBeenCalled();
    });

    test("a failure while replacing a file the user agreed to replace keeps that file as it was", async () => {
        await fsp.mkdir(outDir, { recursive: true });
        const target = path.join(outDir, "Artist - Song.flac");
        await fsp.writeFile(target, "THE USER'S OWN FILE");
        hoisted.tagAudioFile.mockRejectedValue(new Error("disk full"));
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        await expect(task.saveTrack()).rejects.toThrow("disk full");

        expect(confirmOverwrite).toHaveBeenCalledWith(target);
        expect(await read(target)).toBe("THE USER'S OWN FILE");
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
    });

    test("a failure after the new file is in place removes the file this save made, and keeps the old one", async () => {
        // The track was saved as FLAC; the format setting is now MP3, so saving makes a new file and then deletes the
        // old one. The old one cannot be deleted (a locked file): the new one must not be left beside it.
        const oldFile = path.join(outDir, "Artist - Song.flac");
        await fsp.mkdir(outDir, { recursive: true });
        await fsp.writeFile(oldFile, "OLD");
        Object.assign(hoisted.settings, { convertAudio: true, convertFormat: "mp3" });
        const source = await download("dl.flac", "AUDIO");
        const task = makeTask([source], savedAs(oldFile, undefined, { downloadPath: path.join(tmpDir, "older.flac") }));

        const realUnlink = fsp.unlink.bind(fsp);
        vi.spyOn(fsp, "unlink").mockImplementation(async (file) => {
            if (String(file) === oldFile) throw Object.assign(new Error("locked"), { code: "EPERM" });
            return realUnlink(file);
        });

        await expect(task.saveTrack()).rejects.toThrow("locked");

        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
        expect(await read(oldFile)).toBe("OLD");
        expect(savedOf(task)?.path).toBe(oldFile);
        expect(status(task)).toMatchObject({ type: StatusType.Error, message: "Save failed" });
    });
});

// ── a name that is taken ──────────────────────────────────────────────────────

describe("saveTrack — a file name that is already used", () => {
    test("keeps the other file, and writes nothing, when the user says no", async () => {
        await fsp.mkdir(outDir, { recursive: true });
        const target = path.join(outDir, "Artist - Song.flac");
        await fsp.writeFile(target, "ANOTHER TRACK");
        confirmOverwrite.mockResolvedValue(false);
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        await task.saveTrack();

        expect(await read(target)).toBe("ANOTHER TRACK");
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
        expect(hoisted.tagAudioFile).not.toHaveBeenCalled();
        expect(savedOf(task)).toBeUndefined();
    });

    test("with no one to answer (no screen), the other file is kept", async () => {
        await fsp.mkdir(outDir, { recursive: true });
        const target = path.join(outDir, "Artist - Song.flac");
        await fsp.writeFile(target, "ANOTHER TRACK");
        m.overwriteConfirmBridge.setOpener(null);
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        await task.saveTrack();

        expect(await read(target)).toBe("ANOTHER TRACK");
        expect(savedOf(task)).toBeUndefined();
    });

    test("replaces it when the user agrees", async () => {
        await fsp.mkdir(outDir, { recursive: true });
        const target = path.join(outDir, "Artist - Song.flac");
        await fsp.writeFile(target, "ANOTHER TRACK");
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        await task.saveTrack();

        expect(confirmOverwrite).toHaveBeenCalledWith(target);
        expect(await read(target)).toBe("AUDIO|tagged");
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
    });

    test("the track's own saved file is replaced without asking", async () => {
        const first = await download("first.flac", "FIRST");
        const task = makeTask([first]);
        await task.saveTrack();
        const second = await download("second.flac", "SECOND", false);
        task.updateAttributes({
            downloadSources: [
                { ...first, selected: false },
                { ...second, selected: true },
            ],
        });

        await task.saveTrack();

        expect(confirmOverwrite).not.toHaveBeenCalled();
        expect(await read(path.join(outDir, "Artist - Song.flac"))).toBe("SECOND|tagged");
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
        expect(savedOf(task)?.downloadPath).toBe(second.localFile!.path);
    });

    test("two tracks saved to one name at once: the second asks about the file the first made", async () => {
        const a = makeTask([await download("a.flac", "FROM-A")]);
        const b = makeTask([await download("b.flac", "FROM-B")]);

        await Promise.all([a.saveTrack(), b.saveTrack()]);

        expect(confirmOverwrite).toHaveBeenCalledTimes(1);
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
    });
});

// ── a track that is already saved ─────────────────────────────────────────────

describe("saveTrack — a track that is already saved", () => {
    async function savedTrack(content = "AUDIO|tagged") {
        const source = await download("dl.flac", "AUDIO");
        await fsp.mkdir(outDir, { recursive: true });
        const file = path.join(outDir, "Artist - Song.flac");
        await fsp.writeFile(file, content);
        return { source, file, task: makeTask([source], savedAs(file, source)) };
    }

    test("a new name renames the file after re-tagging a copy of it: one file, at the new path", async () => {
        const { file, task } = await savedTrack();
        task.setOutputFilename("Renamed.flac");

        await task.saveTrack({ fromSaved: true });

        const renamed = path.join(outDir, "Renamed.flac");
        expect(await outFiles()).toEqual(["Renamed.flac"]);
        expect(await read(renamed)).toBe("AUDIO|tagged|tagged");
        expect(await exists(file)).toBe(false);
        expect(savedOf(task)).toMatchObject({ path: renamed, writtenPath: renamed });
        // The tags went on a copy beside the file, never on the file itself.
        expect(path.basename(hoisted.tagAudioFile.mock.calls[0][0])).toMatch(/\.saving-[0-9a-f]+\.flac$/);
    });

    test("a tagging failure leaves the file where it is, as it was, and the record unchanged", async () => {
        const { file, task } = await savedTrack();
        task.setOutputFilename("Renamed.flac");
        hoisted.tagAudioFile.mockRejectedValue(new Error("cannot write the tags"));

        await expect(task.saveTrack({ fromSaved: true })).rejects.toThrow("cannot write the tags");

        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
        expect(await read(file)).toBe("AUDIO|tagged");
        expect(savedOf(task)?.path).toBe(file);
        expect(status(task)).toMatchObject({ type: StatusType.Error, message: "Save failed" });
    });

    test("without 'write the tags', a rename only moves the file", async () => {
        const { task } = await savedTrack();
        task.setOverwriteTags(false);
        task.setOutputFilename("Renamed.flac");

        await task.saveTrack({ fromSaved: true });

        expect(hoisted.tagAudioFile).not.toHaveBeenCalled();
        expect(await read(path.join(outDir, "Renamed.flac"))).toBe("AUDIO|tagged");
        expect(await outFiles()).toEqual(["Renamed.flac"]);
    });

    test("another format deletes the old file only once the new one is complete", async () => {
        const { source, file, task } = await savedTrack();
        Object.assign(hoisted.settings, { convertAudio: true, convertFormat: "mp3" });
        // The old file must still be there when the new one is being made.
        let oldFileDuringConversion: boolean | undefined;
        hoisted.convertAudioInto.mockImplementation(async (from: string, to: string) => {
            oldFileDuringConversion = await exists(file);
            await fsp.writeFile(to, `${await fsp.readFile(from, "utf8")}|as-mp3`);
        });

        await task.saveTrack();

        expect(oldFileDuringConversion).toBe(true);
        expect(await outFiles()).toEqual(["Artist - Song.mp3"]);
        expect(savedOf(task)).toMatchObject({
            path: path.join(outDir, "Artist - Song.mp3"),
            downloadPath: source.localFile!.path,
        });
        expect(savedOf(task)?.converted?.format).toBe("mp3");
    });

    test("another format that fails to convert keeps the old file and its record", async () => {
        const { file, task } = await savedTrack();
        Object.assign(hoisted.settings, { convertAudio: true, convertFormat: "mp3" });
        hoisted.convertAudioInto.mockRejectedValue(new Error("ffmpeg exited with code 1"));

        await expect(task.saveTrack()).rejects.toThrow("ffmpeg");

        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
        expect(await read(file)).toBe("AUDIO|tagged");
        expect(savedOf(task)?.path).toBe(file);
    });

    test("a different download that fails to tag leaves the saved file as it was", async () => {
        const { file, task } = await savedTrack("OLD CONTENT");
        const other = await download("other.flac", "OTHER", false);
        task.updateAttributes({
            downloadSources: [
                { ...(task.getAttributes()!.downloadSources[0] as TrackDownloadSource), selected: false },
                { ...other, selected: true },
            ],
        });
        hoisted.tagAudioFile.mockRejectedValue(new Error("boom"));

        await expect(task.saveTrack()).rejects.toThrow("boom");

        expect(await read(file)).toBe("OLD CONTENT");
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
    });

    describe("a file the user relocated", () => {
        // The app wrote it in the output folder; the user moved it, and told the app (Ctrl+F).
        async function relocated() {
            const source = await download("dl.flac", "AUDIO");
            const kept = path.join(elsewhereDir, "my copy.flac");
            await fsp.writeFile(kept, "THE USER'S COPY");
            const writtenPath = path.join(outDir, "Artist - Song.flac");
            // Saved from an older download, so this save makes a new file instead of moving the kept one back.
            const task = makeTask(
                [source],
                savedAs(kept, undefined, { writtenPath, downloadPath: path.join(tmpDir, "older.flac") })
            );
            return { kept, task, writtenPath };
        }

        test("is kept when the user says so, and the new file is still saved", async () => {
            const { kept, task, writtenPath } = await relocated();
            confirmDialog.mockResolvedValue(0);

            await task.saveTrack();

            expect(confirmDialog).toHaveBeenCalledTimes(1);
            expect(await read(kept)).toBe("THE USER'S COPY");
            expect(await read(writtenPath)).toBe("AUDIO|tagged");
            expect(savedOf(task)?.path).toBe(writtenPath);
        });

        test("is deleted only when the user says so", async () => {
            const { kept, task, writtenPath } = await relocated();
            confirmDialog.mockResolvedValue(1);

            await task.saveTrack();

            expect(await exists(kept)).toBe(false);
            expect(await read(writtenPath)).toBe("AUDIO|tagged");
        });

        test("is kept when nobody answers", async () => {
            const { kept, task } = await relocated();
            confirmDialog.mockResolvedValue(null);

            await task.saveTrack();

            expect(await exists(kept)).toBe(true);
        });
    });
});

// ── one save at a time ────────────────────────────────────────────────────────

describe("saveTrack — one at a time", () => {
    test("a second call while the first is still running does nothing", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        hoisted.tagAudioFile.mockImplementation(async (file: string) => {
            await gate;
            await fsp.appendFile(file, "|tagged");
        });
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        const first = task.saveTrack();
        // Let the first one reach the tagging step.
        await vi.waitFor(() => expect(hoisted.tagAudioFile).toHaveBeenCalledTimes(1));
        await task.saveTrack();
        release();
        await first;

        expect(hoisted.tagAudioFile).toHaveBeenCalledTimes(1);
        expect(await outFiles()).toEqual(["Artist - Song.flac"]);
    });

    test("a save can be made again once the failed one is over", async () => {
        hoisted.tagAudioFile.mockRejectedValueOnce(new Error("first try fails"));
        const task = makeTask([await download("dl.flac", "AUDIO")]);

        await expect(task.saveTrack()).rejects.toThrow("first try fails");
        await task.saveTrack();

        expect(await read(path.join(outDir, "Artist - Song.flac"))).toBe("AUDIO|tagged");
        expect(status(task)).toMatchObject({ type: StatusType.Success, message: "Saved" });
    });
});
