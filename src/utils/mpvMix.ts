import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { ensureMpv } from "./mpv-setup";

// Plays a timeline of overlapping sounds. MpvPlayer can't: it holds a single track, and it
// belongs to the user's music. Here one short-lived mpv mixes every sound through a filter
// graph, so the timing between them is sample-accurate rather than a race of timers.
// Seeking ends such a graph, so a mix can only ever be played from the start.

// Everything is resampled to this before mixing: the sources vary from 44.1 to 96 kHz.
const MIX_FORMAT = "aformat=sample_rates=48000:channel_layouts=stereo";
const FADE_STEP_MS = 30;

/** One sound on a mix's timeline. Times are in seconds. */
export interface MixCue {
    file: string;
    /** When it starts on the timeline. */
    at: number;
    gainDb?: number;
    /** Skip this much of the sound, e.g. the silence before a transient. */
    from?: number;
    /** Keep only this much of the sound. */
    duration?: number;
    fadeIn?: number;
    /** Needs `duration`. */
    fadeOut?: number;
    /** -1 (left) to 1 (right). */
    pan?: number;
    /** Extra lavfi filters, applied first: `from` and `duration` are measured after them. */
    filter?: string;
    /** Repeats the sound's first this-many samples; forever, unless `duration` cuts it. */
    loopSamples?: number;
}

function cueFilters(cue: MixCue): string {
    const { from = 0, duration, fadeIn, fadeOut, pan, gainDb = 0, filter, loopSamples } = cue;
    const end = duration === undefined ? "" : `:end=${from + duration}`;
    const filters = [
        ...(loopSamples ? [`aloop=loop=-1:size=${loopSamples}`] : []),
        ...(filter ? [filter] : []),
        `atrim=start=${from}${end}`,
        "asetpts=PTS-STARTPTS",
        ...(fadeIn ? [`afade=t=in:d=${fadeIn}`] : []),
        ...(fadeOut && duration ? [`afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`] : []),
        ...(pan ? [`stereotools=balance_out=${pan}`] : []),
        `volume=${gainDb}dB`,
        MIX_FORMAT,
        `adelay=${Math.round(cue.at * 1000)}:all=1`,
    ];
    return filters.join(",");
}

/** Each file once, in the order of its first cue: every track takes mpv ~11ms to open. */
export const mixFiles = (cues: MixCue[]): string[] => [...new Set(cues.map((cue) => cue.file))];

/** mpv numbers audio tracks from 1, in the order the files are given. */
export function buildMixGraph(cues: MixCue[]): string {
    const splits = mixFiles(cues).flatMap((file, track) => {
        const users = cues.flatMap((cue, i) => (cue.file === file ? [i] : []));
        const outputs = users.map((i) => `[in${i}]`).join("");
        return `[aid${track + 1}]${users.length > 1 ? `asplit=${users.length}` : "anull"}${outputs}`;
    });
    const chains = cues.map((cue, i) => `[in${i}]${cueFilters(cue)}[cue${i}]`);
    const inputs = cues.map((_, i) => `[cue${i}]`).join("");
    return [...splits, ...chains, `${inputs}amix=inputs=${cues.length}:normalize=0:duration=longest[ao]`].join(";");
}

let mixCount = 0;

export class MpvMix {
    private mpvProcess: ChildProcess | null = null;
    private socket: net.Socket | null = null;
    private fadeTimer: ReturnType<typeof setInterval> | null = null;
    private stopped = false;

    /** Resolves to the `performance.now()` of the mix's time 0, or null if it won't play. */
    readonly started: Promise<number | null>;

    /** A paused mix loads now but only plays on `resume()`: it starts without spawn lag. */
    constructor(
        cues: MixCue[],
        private readonly volume: number,
        private paused = false
    ) {
        this.started = this.start(cues).catch(() => null);
    }

    private async start(cues: MixCue[]): Promise<number | null> {
        if (process.env["GOBLIN_NO_AUDIO"]) return null;
        if (!cues.every((cue) => fs.existsSync(cue.file))) return null;

        const mpvBin = await ensureMpv();
        if (this.stopped) return null;

        const id = `mpv-mix-${process.pid}-${++mixCount}`;
        const isWindows = process.platform === "win32";
        const socketArg = isWindows ? id : path.join(os.tmpdir(), `${id}.sock`);
        const socketPath = isWindows ? `\\\\.\\pipe\\${id}` : socketArg;

        // Relative paths: Windows caps a command line at 32k characters, and a cue sheet
        // of long sample names adds up.
        const cwd = path.dirname(cues[0].file);
        const [first, ...others] = mixFiles(cues).map((file) => path.relative(cwd, file));
        const mpvProcess = spawn(
            mpvBin,
            [
                // A fixed setup: the user's mpv.conf is for their music, not for this graph.
                "--no-config",
                "--no-video",
                "--no-terminal",
                `--volume=${this.volume}`,
                ...(this.paused ? ["--pause"] : []),
                `--input-ipc-server=${socketArg}`,
                ...others.map((file) => `--external-file=${file}`),
                `--lavfi-complex=${buildMixGraph(cues)}`,
                "--",
                first,
            ],
            // mpv resolves paths against $PWD when it's set, whatever its real cwd is.
            { cwd, env: { ...process.env, PWD: cwd }, stdio: "ignore", windowsHide: true }
        );
        this.mpvProcess = mpvProcess;

        const killOnExit = () => mpvProcess.kill();
        process.once("exit", killOnExit);

        return new Promise((resolve) => {
            const onGone = () => {
                process.removeListener("exit", killOnExit);
                this.mpvProcess = null;
                this.socket?.destroy();
                this.socket = null;
                resolve(null);
            };
            mpvProcess.once("exit", onGone);
            mpvProcess.once("error", onGone);
            this.connect(socketPath, resolve);
        });
    }

    private connect(socketPath: string, onPlaying: (timeZero: number) => void): void {
        const sock = new net.Socket();
        sock.once("error", () => {
            sock.destroy();
            if (this.mpvProcess) setTimeout(() => this.connect(socketPath, onPlaying), 10);
        });
        sock.connect(socketPath, () => {
            sock.removeAllListeners("error");
            sock.on("error", () => {});
            this.socket = sock;
            // Not a "started" event, which we'd miss if we connected late: an observed property
            // always reports its state. Nor playback-time, which such a graph leaves unset for
            // its first seconds.
            this.send(["observe_property", 1, "core-idle"]);
            if (!this.paused) this.send(["set_property", "pause", false]);
            let buffer = "";
            sock.on("data", (data) => {
                buffer += data.toString("utf8");
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    const { name, data } = JSON.parse(line) as { name?: string; data?: unknown };
                    if (name === "core-idle" && data === false) onPlaying(performance.now());
                }
            });
        });
    }

    private send(command: unknown[]): void {
        this.socket?.write(JSON.stringify({ command }) + "\n");
    }

    /** Starts a paused mix, as soon as it has loaded if it hasn't yet. */
    resume(): void {
        this.paused = false;
        this.send(["set_property", "pause", false]);
    }

    /** Fades out over `seconds`, then stops. */
    fadeOut(seconds: number): void {
        if (this.fadeTimer) return;
        const startedAt = performance.now();
        this.fadeTimer = setInterval(() => {
            const k = (performance.now() - startedAt) / (seconds * 1000);
            if (k >= 1) return this.stop();
            this.send(["set_property", "volume", this.volume * (1 - k)]);
        }, FADE_STEP_MS);
    }

    /** Stops a mix that was never resumed; one that's playing runs to its end. */
    dismiss(): void {
        if (this.paused) this.stop();
    }

    stop(): void {
        this.stopped = true;
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.mpvProcess?.kill();
    }
}
