import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import { registerAgentCleanup } from "#base/agent/cleanup";
import { killProcessTree } from "./killProcessTree";
import { ensureMpv } from "./mpv-setup";
import { createIpcEndpoint } from "./ipcEndpoint";

/**
 * Plays several files at once as one mix, each with its own gain (P33's stem player: the track and its stems). One
 * mpv decodes them all and mixes them through `lavfi-complex` (`amix`), so they never drift apart the way several
 * players would. Measured on mpv 0.41 (P33): a seek moves every file, and the mix can be changed while it plays
 * (setting `lavfi-complex` again: muting, a solo) without losing the position.
 *
 * It is not `MpvPlayer` (the preview of one file, shared by the whole app): each mix is its own short-lived mpv,
 * started with its files and ended by `stop()`.
 */
export type MixerStatus = {
    files: string[];
    loaded: boolean;
    paused: boolean;
    positionMs: number;
    durationMs: number;
};

/** The mix graph: file `i` is mpv's audio track `i + 1`, times its gain, all summed (no level change). */
export function buildGainGraph(gains: readonly number[]): string {
    const inputs = gains.map((gain, i) => `[aid${i + 1}]volume=${gain.toFixed(3)}[a${i}]`);
    const mix = `${gains.map((_, i) => `[a${i}]`).join("")}amix=inputs=${gains.length}:normalize=0[ao]`;
    return [...inputs, mix].join(";");
}

export class MpvMixer extends EventEmitter {
    private child: ChildProcess | null = null;
    private socket: net.Socket | null = null;
    private forget: (() => void) | null = null;
    private requestId = 0;
    private readonly pending = new Map<number, (ok: boolean) => void>();
    private buffer = "";
    private status: MixerStatus = { files: [], loaded: false, paused: false, positionMs: 0, durationMs: 0 };
    /** Bumped by every load and stop: a slow start that was replaced since must not take over. */
    private generation = 0;

    constructor() {
        super();
        this.on("error", () => {});
        process.once("exit", () => this.child?.kill());
    }

    getStatus(): MixerStatus {
        return this.status;
    }

    private set(patch: Partial<MixerStatus>): void {
        this.status = { ...this.status, ...patch };
        this.emit("change", this.status);
    }

    /** Starts a mix of `files` with `gains`, from `startMs`, paused or not. Replaces any mix playing. */
    async load(files: string[], gains: number[], startMs = 0, paused = false): Promise<void> {
        await this.stop();
        if (process.env["GOBLIN_NO_AUDIO"] || files.length === 0) return;
        const generation = ++this.generation;
        const endpoint = await createIpcEndpoint(`mpv-mix-${process.pid}`);
        const mpv = await ensureMpv();
        if (generation !== this.generation) return;
        const args = [
            "--no-video",
            "--no-terminal",
            "--really-quiet",
            "--idle=yes",
            // At the end the mix stays loaded (paused on its last frame), so it can be played again or sought back.
            "--keep-open=yes",
            `--input-ipc-server=${endpoint.arg}`,
            `--start=${(startMs / 1000).toFixed(3)}`,
            ...(paused ? ["--pause"] : []),
            // One option per file (the append form): a joined list is split on `;` / `:`, which a path can contain.
            ...files.slice(1).map((file) => `--external-file=${file}`),
            `--lavfi-complex=${buildGainGraph(gains)}`,
            files[0],
        ];
        const child = spawn(mpv, args, { stdio: "ignore", windowsHide: true });
        this.child = child;
        this.forget = registerAgentCleanup(() => killProcessTree(child));
        child.on("exit", () => {
            if (this.child !== child) return;
            this.child = null;
            this.socket?.destroy();
            this.socket = null;
            this.forget?.();
            this.set({ loaded: false, paused: false });
        });
        this.set({ files, loaded: true, paused, positionMs: startMs, durationMs: 0 });
        try {
            await this.connect(endpoint.path, generation);
            await this.command(["observe_property", 1, "time-pos"]);
            await this.command(["observe_property", 2, "duration"]);
            await this.command(["observe_property", 3, "pause"]);
        } catch (error) {
            this.emit("error", error);
        }
    }

    private async connect(socketPath: string, generation: number): Promise<void> {
        for (let attempt = 0; attempt < 50; attempt++) {
            if (generation !== this.generation) throw new Error("replaced");
            if (process.platform !== "win32") {
                const exists = await fs.promises.access(socketPath).then(
                    () => true,
                    () => false
                );
                if (!exists) {
                    await new Promise((r) => setTimeout(r, 50));
                    continue;
                }
            }
            const ok = await new Promise<boolean>((resolve) => {
                const sock = net.connect(socketPath, () => {
                    this.socket = sock;
                    sock.on("data", (data) => this.onData(data.toString("utf8")));
                    sock.on("error", (err) => this.emit("error", err));
                    resolve(true);
                });
                sock.once("error", () => {
                    sock.destroy();
                    resolve(false);
                });
            });
            if (ok) return;
            await new Promise((r) => setTimeout(r, 80));
        }
        throw new Error("Could not connect to the mixer's mpv");
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.trim()) continue;
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(line) as Record<string, unknown>;
            } catch {
                continue;
            }
            if (typeof msg.request_id === "number") {
                this.pending.get(msg.request_id)?.(msg.error === "success");
                this.pending.delete(msg.request_id);
            }
            if (msg.event === "property-change") {
                if (msg.name === "time-pos" && typeof msg.data === "number") {
                    this.set({ positionMs: Math.round(msg.data * 1000) });
                } else if (msg.name === "duration" && typeof msg.data === "number") {
                    this.set({ durationMs: Math.round(msg.data * 1000) });
                } else if (msg.name === "pause" && typeof msg.data === "boolean") {
                    this.set({ paused: msg.data });
                }
            }
        }
    }

    private command(cmd: unknown[]): Promise<boolean> {
        const socket = this.socket;
        if (!socket) return Promise.resolve(false);
        return new Promise((resolve) => {
            const id = ++this.requestId;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve(false);
            }, 5000);
            this.pending.set(id, (ok) => {
                clearTimeout(timer);
                resolve(ok);
            });
            socket.write(JSON.stringify({ command: cmd, request_id: id }) + "\n");
        });
    }

    /** Changes the gains of the files playing (a mute, a solo), keeping the position. */
    async setGains(gains: number[]): Promise<void> {
        if (gains.length !== this.status.files.length) return;
        await this.command(["set_property", "lavfi-complex", buildGainGraph(gains)]);
    }

    async setPaused(paused: boolean): Promise<void> {
        await this.command(["set_property", "pause", paused]);
    }

    async seekMs(ms: number): Promise<void> {
        await this.command(["seek", Math.max(0, ms) / 1000, "absolute+exact"]);
    }

    /** Ends the mix (its mpv quits). */
    async stop(): Promise<void> {
        this.generation++;
        const child = this.child;
        this.child = null;
        if (child) {
            await this.command(["quit"]).catch(() => false);
            this.socket?.destroy();
            this.socket = null;
            killProcessTree(child);
            this.forget?.();
            this.forget = null;
        }
        if (this.status.loaded) this.set({ loaded: false, paused: false, positionMs: 0, durationMs: 0, files: [] });
    }
}

let instance: MpvMixer | null = null;

/** The app's one mixer (one stem player plays at a time). */
export function getMixer(): MpvMixer {
    instance ??= new MpvMixer();
    return instance;
}
