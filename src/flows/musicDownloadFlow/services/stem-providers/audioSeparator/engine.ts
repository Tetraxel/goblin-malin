import { spawn, execFile } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";
import { getAppDataDir } from "#utils/appPaths";
import { ensureFfmpeg } from "#utils/ffmpeg-setup";
import { ensureFfprobe } from "#utils/ffprobe-setup";
import { killProcessTree } from "#utils/killProcessTree";
import { createLineSplitter } from "#utils/lineSplitter";
import { registerAgentCleanup } from "#base/agent/cleanup";
import { globalLogger, type Logger } from "#base/logger/logger";
import {
    type SeparateRequest,
    type SeparatedStem,
    type StemDevice,
    type StemEngine,
    type StemEngineStatus,
    type StemModel,
    type StemProgress,
} from "../../../stems/stemService";
import { normalizeStemKind } from "../../../stems/stemKinds";
import { ensureUv } from "./uvSetup";
import { SeparatorProgress, UvInstallProgress, parseSeparatorLine, stemFromOutputName } from "./progress";

const execFileAsync = promisify(execFile);

/** The audio-separator release the app installs (https://github.com/nomadkaraoke/python-audio-separator). */
export const AUDIO_SEPARATOR_VERSION = "0.48.0";
/** The Python uv installs for it (its own copy: the user's Python is never used or changed). */
const PYTHON_VERSION = "3.12";
/** A separation that writes nothing for this long is stuck: it is stopped. A CPU pass can be slow, not silent. */
const STALL_MS = 10 * 60_000;
/** The model list and status calls start Python and PyTorch: a few seconds, never minutes. */
const QUICK_CALL_MS = 2 * 60_000;

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** Everything lives in `<data>/stems/`: delete the folder and the engine is gone. */
export function stemsRoot(): string {
    return path.join(getAppDataDir(), "stems");
}

const paths = {
    tools: () => path.join(stemsRoot(), "tools"),
    toolBin: () => path.join(stemsRoot(), "tools", "bin"),
    python: () => path.join(stemsRoot(), "python"),
    cache: () => path.join(stemsRoot(), "cache"),
    models: () => path.join(stemsRoot(), "models"),
    ffmpeg: () => path.join(stemsRoot(), "ffmpeg"),
    install: () => path.join(stemsRoot(), "install.json"),
    modelList: () => path.join(stemsRoot(), "models.json"),
    exe: () => path.join(stemsRoot(), "tools", "bin", exe("audio-separator")),
};

type InstallRecord = { build: StemDevice; version: string; installedAt: string };

/** What `--list_models --list_format json` gives: `{ family: { label: { filename, stems, download_files } } }`. */
type RawModelList = Record<
    string,
    Record<string, { filename?: string; stems?: string[]; download_files?: string[] } | undefined>
>;

type ListedModel = Omit<StemModel, "downloaded" | "sizeBytes"> & { files: string[] };

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(
        () => true,
        () => false
    );
}

/** The total size of a folder's files; 0 when it does not exist. Asynchronous: the engine holds tens of thousands. */
async function folderBytes(dir: string): Promise<number> {
    let total = 0;
    let entries: import("fs").Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += await folderBytes(full);
        else if (entry.isFile())
            total += await fs.stat(full).then(
                (s) => s.size,
                () => 0
            );
    }
    return total;
}

/** The file name a model's download is stored under (`download_files` holds names and URLs). */
function storedName(file: string): string {
    return file.split(/[\\/]/).pop() ?? file;
}

/** The model list, flattened: one entry per model, its stems in lower case. */
export function parseModelList(raw: RawModelList): ListedModel[] {
    const models: ListedModel[] = [];
    for (const [family, entries] of Object.entries(raw ?? {})) {
        for (const [label, info] of Object.entries(entries ?? {})) {
            if (!info?.filename) continue;
            models.push({
                id: info.filename,
                label,
                family,
                stems: (info.stems ?? []).map(normalizeStemKind),
                files: (info.download_files ?? [info.filename]).map(storedName),
            });
        }
    }
    return models;
}

/**
 * The environment of every program of the engine: uv keeps everything in the stems folder (`only-managed`: its own
 * Python, never one found on the computer; `UV_NO_CONFIG`: no `uv.toml` of the user applies). The credentials are
 * already out of `process.env` (`appSecrets`), so nothing secret is passed on.
 */
function engineEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
        ...process.env,
        UV_TOOL_DIR: paths.tools(),
        UV_TOOL_BIN_DIR: paths.toolBin(),
        UV_PYTHON_INSTALL_DIR: paths.python(),
        UV_CACHE_DIR: paths.cache(),
        UV_PYTHON_PREFERENCE: "only-managed",
        UV_NO_CONFIG: "1",
        UV_NO_PROGRESS: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
        ...extra,
    };
}

type RunOptions = {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    /** Each line of stdout and stderr (progress bars end with `\r`: they are lines too). */
    onLine?: (line: string, stream: "stdout" | "stderr") => void;
    /** Stop the program when it writes nothing for this long. */
    stallMs?: number;
    logger?: Logger;
    what: string;
};

/**
 * Runs one program of the engine to its end. Its tree is stopped by the signal, a stall, or closing the app
 * (`registerAgentCleanup`). Rejects with the last lines it wrote when it fails.
 */
function runProgram(command: string, args: string[], options: RunOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        if (options.signal?.aborted) return reject(new DOMException("Stopped", "AbortError"));
        const logger = options.logger ?? globalLogger;
        logger.debug(`${options.what}: ${command} ${args.join(" ")}`);
        const child = spawn(command, args, { env: options.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const forget = registerAgentCleanup(() => killProcessTree(child));
        const tail: string[] = [];
        let stalled = false;
        let stallTimer: NodeJS.Timeout | undefined;
        const armStall = () => {
            if (!options.stallMs) return;
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                stalled = true;
                killProcessTree(child);
            }, options.stallMs);
        };
        armStall();

        // `\r` ends a progress bar's line: read it as a line break too.
        const splitterFor = (stream: "stdout" | "stderr") =>
            createLineSplitter((line) => {
                for (const part of line.split("\r")) {
                    if (!part.trim()) continue;
                    tail.push(part);
                    if (tail.length > 40) tail.shift();
                    options.onLine?.(part, stream);
                }
            });
        const splitters = { stdout: splitterFor("stdout"), stderr: splitterFor("stderr") };
        const onData = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
            armStall();
            splitters[stream].write(chunk.toString("utf8").replace(/\r(?!\n)/g, "\n"));
        };
        child.stdout?.on("data", onData("stdout"));
        child.stderr?.on("data", onData("stderr"));

        const onAbort = () => killProcessTree(child);
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const finish = (error?: Error) => {
            clearTimeout(stallTimer);
            options.signal?.removeEventListener("abort", onAbort);
            forget();
            splitters.stdout.end();
            splitters.stderr.end();
            if (error) reject(error);
            else resolve();
        };
        child.on("error", (error) => finish(error));
        child.on("close", (code) => {
            if (options.signal?.aborted) return finish(new DOMException("Stopped", "AbortError"));
            if (stalled)
                return finish(new Error(`${options.what} stopped: no output for ${options.stallMs! / 60_000} minutes`));
            if (code === 0) return finish();
            const lastLines = tail.filter((l) => !parseSeparatorLine(l) || parseSeparatorLine(l)?.kind !== "pass");
            finish(new Error(`${options.what} failed (exit code ${code}): ${lastLines.slice(-3).join(" | ")}`));
        });
    });
}

/**
 * A folder holding `ffmpeg` / `ffprobe` under their plain names, linked to the app's own copies: audio-separator
 * refuses to start without an `ffmpeg` on PATH (spike), and the app's copies have versioned names. Hard links (no
 * copy of 130 MB); a copy where the data folder spans two drives.
 */
async function ensureFfmpegFolder(): Promise<string> {
    const dir = paths.ffmpeg();
    await fs.mkdir(dir, { recursive: true });
    for (const [name, source] of [
        ["ffmpeg", await ensureFfmpeg(false)],
        ["ffprobe", await ensureFfprobe(false)],
    ] as const) {
        const target = path.join(dir, exe(name));
        // Re-linked every time: the app's copy may have been updated (its old version deleted) since.
        const sameFile = await Promise.all([fs.stat(target), fs.stat(source)]).then(
            ([a, b]) => a.ino === b.ino && a.dev === b.dev && a.ino !== 0,
            () => false
        );
        if (sameFile) continue;
        await fs.rm(target, { force: true });
        await fs.link(source, target).catch(() => fs.copyFile(source, target));
    }
    return dir;
}

class AudioSeparatorEngine implements StemEngine {
    private listCache?: ListedModel[];
    /** One install / uninstall / model change at a time: they all rewrite the same folder. */
    private queue: Promise<unknown> = Promise.resolve();

    /** Separations running now: the engine's files are not changed under them. */
    private separations = 0;
    /** Set while an install, uninstall or model removal rewrites the folder: no separation starts meanwhile. */
    private changing = false;

    private exclusive<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => {});
        return next;
    }

    /**
     * Runs `work` (which replaces or deletes the engine's files) in turn, refused while a separation runs: deleting
     * the Python or a model under the running program would break it (and fail half-way on Windows, files locked).
     */
    private changeFiles<T>(what: string, work: () => Promise<T>): Promise<T> {
        return this.exclusive(async () => {
            if (this.separations > 0) throw new Error(`Cannot ${what} while stems are being separated: stop it first`);
            this.changing = true;
            try {
                return await work();
            } finally {
                this.changing = false;
            }
        });
    }

    private async installRecord(): Promise<InstallRecord | undefined> {
        try {
            const record = JSON.parse(await fs.readFile(paths.install(), "utf8")) as InstallRecord;
            if (!(await exists(paths.exe()))) return undefined;
            return record;
        } catch {
            return undefined;
        }
    }

    async installedBuild(): Promise<StemDevice | undefined> {
        return (await this.installRecord())?.build;
    }

    async status(): Promise<StemEngineStatus> {
        const record = await this.installRecord();
        if (!record) return { installed: false, modelBytes: await folderBytes(paths.models()) };
        const [engineBytes, pythonBytes, modelBytes] = await Promise.all([
            folderBytes(paths.tools()),
            folderBytes(paths.python()),
            folderBytes(paths.models()),
        ]);
        return {
            installed: true,
            version: record.version,
            build: record.build,
            engineBytes: engineBytes + pythonBytes,
            modelBytes,
        };
    }

    async detectGpu(): Promise<string | undefined> {
        if (process.platform === "darwin") return undefined;
        try {
            const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
                timeout: 10_000,
                windowsHide: true,
            });
            return stdout
                .split(/\r?\n/)
                .find((line) => line.trim())
                ?.trim();
        } catch {
            return undefined;
        }
    }

    install(
        build: StemDevice,
        options: { signal?: AbortSignal; onProgress?: (p: StemProgress) => void } = {}
    ): Promise<void> {
        return this.changeFiles("install the engine", async () => {
            options.onProgress?.({ text: "Downloading uv" });
            const uv = await ensureUv();
            await fs.mkdir(stemsRoot(), { recursive: true });
            const spec = `audio-separator[${build === "cuda" ? "gpu" : "cpu"}]==${AUDIO_SEPARATOR_VERSION}`;
            options.onProgress?.({ text: `Installing audio-separator ${AUDIO_SEPARATOR_VERSION} (${build})` });
            // uv draws no bar through a pipe: the bar is built from its lines, and asked again every half second so
            // it moves while the big download (torch) says nothing (see `UvInstallProgress`).
            const progress = new UvInstallProgress();
            const report = () => options.onProgress?.(progress.snapshot(Date.now()));
            const ticker = setInterval(report, 500);
            try {
                await runProgram(
                    uv,
                    [
                        "tool",
                        "install",
                        spec,
                        // 0.48.0 imports `audioread` without declaring it (spike): without it, every command fails.
                        "--with",
                        "audioread",
                        "--python",
                        PYTHON_VERSION,
                        // `auto` picks the CUDA build of PyTorch that fits the installed driver.
                        "--torch-backend",
                        build === "cuda" ? "auto" : "cpu",
                        "--force",
                    ],
                    {
                        env: engineEnv(),
                        signal: options.signal,
                        what: "Installing audio-separator",
                        onLine: (line) => {
                            progress.feed(line, Date.now());
                            report();
                        },
                    }
                );
            } finally {
                clearInterval(ticker);
            }
            const record: InstallRecord = {
                build,
                version: AUDIO_SEPARATOR_VERSION,
                installedAt: new Date().toISOString(),
            };
            await fs.writeFile(paths.install(), JSON.stringify(record, null, 2));
            // The downloaded packages are installed now: their cache (as big as the install) is not needed.
            options.onProgress?.({ text: "Cleaning up the download cache", fraction: 0.99 });
            await runProgram(uv, ["cache", "clean"], { env: engineEnv(), what: "Cleaning uv's cache" }).catch((error) =>
                globalLogger.warn("Could not clean uv's cache", { error })
            );
            this.listCache = undefined;
        });
    }

    uninstall(): Promise<void> {
        return this.changeFiles("uninstall the engine", async () => {
            this.listCache = undefined;
            await fs.rm(stemsRoot(), { recursive: true, force: true });
        });
    }

    private async readModelList(refresh: boolean): Promise<ListedModel[]> {
        if (this.listCache && !refresh) return this.listCache;
        if (!refresh) {
            try {
                this.listCache = JSON.parse(await fs.readFile(paths.modelList(), "utf8")) as ListedModel[];
                return this.listCache;
            } catch {
                /* not read yet: ask the engine */
            }
        }
        if (!(await this.installRecord())) throw new Error("The stem separation engine is not installed");
        let stdout = "";
        await runProgram(paths.exe(), ["--list_models", "--list_format", "json", "--model_file_dir", paths.models()], {
            env: engineEnv({ PATH: `${await ensureFfmpegFolder()}${path.delimiter}${process.env.PATH ?? ""}` }),
            what: "Listing the stem models",
            stallMs: QUICK_CALL_MS,
            onLine: (line, stream) => {
                if (stream === "stdout") stdout += line + "\n";
            },
        });
        const start = stdout.indexOf("{");
        if (start === -1) throw new Error("audio-separator listed no model");
        const models = parseModelList(JSON.parse(stdout.slice(start)) as RawModelList);
        await fs.mkdir(stemsRoot(), { recursive: true });
        await fs.writeFile(paths.modelList(), JSON.stringify(models));
        this.listCache = models;
        return models;
    }

    async listModels(options: { refresh?: boolean } = {}): Promise<StemModel[]> {
        const listed = await this.readModelList(!!options.refresh);
        const onDisk = new Map<string, number>();
        try {
            for (const entry of await fs.readdir(paths.models(), { withFileTypes: true })) {
                if (!entry.isFile()) continue;
                onDisk.set(entry.name, (await fs.stat(path.join(paths.models(), entry.name))).size);
            }
        } catch {
            /* no model downloaded yet */
        }
        return listed.map(({ files, ...model }) => {
            const downloaded = files.length > 0 && files.every((file) => onDisk.has(file));
            return {
                ...model,
                downloaded,
                sizeBytes: downloaded ? files.reduce((sum, file) => sum + (onDisk.get(file) ?? 0), 0) : undefined,
            };
        });
    }

    downloadModel(
        id: string,
        options: { signal?: AbortSignal; onProgress?: (p: StemProgress) => void } = {}
    ): Promise<void> {
        return this.exclusive(async () => {
            await fs.mkdir(paths.models(), { recursive: true });
            const progress = new SeparatorProgress();
            await runProgram(paths.exe(), ["--download_model_only", "-m", id, "--model_file_dir", paths.models()], {
                env: engineEnv({ PATH: `${await ensureFfmpegFolder()}${path.delimiter}${process.env.PATH ?? ""}` }),
                signal: options.signal,
                what: `Downloading the model ${id}`,
                stallMs: STALL_MS,
                onLine: (line) => {
                    const p = progress.feed(line);
                    if (p) options.onProgress?.(p);
                },
            });
        });
    }

    removeModel(id: string): Promise<void> {
        return this.changeFiles("remove a model", async () => {
            const model = (await this.readModelList(false)).find((m) => m.id === id);
            if (!model) throw new Error(`Unknown model ${id}`);
            // A file another downloaded model also uses (none today) stays.
            const others = new Set(
                (await this.readModelList(false)).filter((m) => m.id !== id).flatMap((m) => m.files)
            );
            for (const file of model.files) {
                if (others.has(file)) continue;
                await fs.rm(path.join(paths.models(), file), { force: true });
            }
        });
    }

    /**
     * Separates `input` into `<outDir>/<baseName>.<stem>.flac`. The program writes into a folder of its own inside
     * `outDir` under its own names (`<input>_(Vocals)_<model>.flac`): every model is read the same way, even one whose
     * stems are only known once it ran. The files are moved out once the run is complete; on a failure or a stop the
     * folder is deleted, so no partial stem is ever left under a final name.
     */
    async separate(request: SeparateRequest): Promise<SeparatedStem[]> {
        if (this.changing) throw new Error("The stem separation engine is being installed or changed: try again after");
        this.separations++;
        try {
            return await this.separateNow(request);
        } finally {
            this.separations--;
        }
    }

    private async separateNow(request: SeparateRequest): Promise<SeparatedStem[]> {
        const record = await this.installRecord();
        if (!record) throw new Error("The stem separation engine is not installed");
        const stage = path.join(request.outDir, `.separating-${randomUUID()}`);
        await fs.mkdir(stage, { recursive: true });
        try {
            const progress = new SeparatorProgress();
            const ffmpegDir = await ensureFfmpegFolder();
            await runProgram(
                paths.exe(),
                [
                    request.input,
                    "-m",
                    request.model,
                    "--model_file_dir",
                    paths.models(),
                    "--output_dir",
                    stage,
                    "--output_format",
                    "FLAC",
                ],
                {
                    env: engineEnv({
                        PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH ?? ""}`,
                        // The CPU, even with the CUDA build: hiding the cards is how the program is told.
                        ...(request.device === "cpu" ? { CUDA_VISIBLE_DEVICES: "-1" } : {}),
                    }),
                    signal: request.signal,
                    what: `Separating with ${request.model}`,
                    stallMs: STALL_MS,
                    logger: request.logger,
                    onLine: (line) => {
                        const parsed = parseSeparatorLine(line);
                        if (parsed?.kind === "log" && parsed.level !== "DEBUG") {
                            request.logger.debug(`audio-separator: ${parsed.message}`);
                        }
                        const p = progress.feed(line);
                        if (p) request.onProgress(p);
                    },
                }
            ).catch((error: Error) => {
                const detail = progress.error();
                if (detail && error.name !== "AbortError") throw new Error(detail);
                throw error;
            });

            const stems: SeparatedStem[] = [];
            for (const name of await fs.readdir(stage)) {
                const kind = stemFromOutputName(name);
                if (!kind) continue;
                const dest = path.join(
                    request.outDir,
                    `${request.baseName}.${kind.replace(/[\\/:*?"<>|]/g, "_")}.flac`
                );
                await fs.rename(path.join(stage, name), dest);
                stems.push({ kind, path: dest });
            }
            if (stems.length === 0) throw new Error("The separation wrote no stem");
            return stems;
        } finally {
            await fs.rm(stage, { recursive: true, force: true });
        }
    }
}

/** The one engine of the app (shared by every task: installing it, its models). */
export const audioSeparatorEngine = new AudioSeparatorEngine();
