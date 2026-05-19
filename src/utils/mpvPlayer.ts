import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { ensureMpv } from "./mpv-setup";

export interface PlayerStatus {
  isPlaying: boolean;
  isPaused: boolean;
  positionMs: number;
  durationMs: number;
  filePath: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MpvPlayer extends EventEmitter {
  private mpvProcess: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  // What we pass to mpv --input-ipc-server (pipe name only on Windows)
  private readonly mpvIpcArg: string;
  // What Node's net.Socket connects to (full \\.\pipe\ path on Windows)
  private readonly socketPath: string;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readBuffer = "";

  private _filePath: string | null = null;
  private _positionMs = 0;
  private _durationMs = 0;
  private _isPaused = false;
  private _started = false;
  private _starting: Promise<void> | null = null;

  constructor() {
    super();
    const pid = process.pid;
    if (process.platform === "win32") {
      // mpv on Windows prepends \\.\pipe\ automatically — only pass the name
      this.mpvIpcArg = `mpv-ipc-${pid}`;
      // Node.js net.Socket needs the full UNC pipe path
      this.socketPath = `\\\\.\\pipe\\mpv-ipc-${pid}`;
    } else {
      const sockPath = path.join(os.tmpdir(), `mpv-ipc-${pid}.sock`);
      this.mpvIpcArg = sockPath;
      this.socketPath = sockPath;
    }
    // Prevent unhandled 'error' event crash when no component has subscribed yet
    this.on("error", () => { });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  private ensureStarted(): Promise<void> {
    if (this._started) return Promise.resolve();
    if (this._starting) return this._starting;
    this._starting = this._start()
      .then(() => {
        this._started = true;
        this._starting = null;
      })
      .catch((err) => {
        this._starting = null;
        throw err;
      });
    return this._starting;
  }

  private async _start(): Promise<void> {
    if (process.platform !== "win32" && fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    const mpvBin = await ensureMpv();

    this.mpvProcess = spawn(
      mpvBin,
      [
        "--idle=yes",
        "--no-video",
        "--no-terminal",
        "--really-quiet",
        `--input-ipc-server=${this.mpvIpcArg}`,
      ],
      { stdio: "ignore", windowsHide: true },
    );

    this.mpvProcess.on("exit", (code) => {
      this._started = false;
      this.socket?.destroy();
      this.socket = null;
      this._filePath = null;
      this.emit("stateChange", this.getStatus());
      if (code !== 0 && code !== null) {
        this.emit("error", new Error(`mpv exited with code ${code}`));
      }
    });

    await this.waitForSocket();
    await this.connectWithRetry();
    await this.observeProperties();
  }

  private waitForSocket(timeoutMs = 8000): Promise<void> {
    if (process.platform === "win32") {
      // Named pipes appear almost instantly on Windows; a small delay is enough
      return new Promise((resolve) => setTimeout(resolve, 300));
    }
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (fs.existsSync(this.socketPath)) {
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error("Timed out waiting for mpv IPC socket"));
        } else {
          setTimeout(poll, 50);
        }
      };
      setTimeout(poll, 100);
    });
  }

  private connectWithRetry(maxAttempts = 30): Promise<void> {
    let attempt = 0;
    const tryConnect = (): Promise<void> =>
      new Promise((resolve, reject) => {
        const sock = new net.Socket();
        const onError = (err: NodeJS.ErrnoException) => {
          sock.destroy();
          if (++attempt >= maxAttempts) {
            reject(
              new Error(
                `mpv IPC connect failed after ${maxAttempts} attempts: ${err.message}`,
              ),
            );
          } else {
            setTimeout(() => tryConnect().then(resolve).catch(reject), 100);
          }
        };
        sock.once("error", onError);
        sock.connect(this.socketPath, () => {
          sock.removeListener("error", onError);
          this.socket = sock;
          sock.on("error", (err) => this.emit("error", err));
          sock.on("data", (data) => this.onData(data.toString("utf8")));
          resolve();
        });
      });
    return tryConnect();
  }

  // ── Message handling ─────────────────────────────────────────────────

  private onData(chunk: string) {
    this.readBuffer += chunk;
    const parts = this.readBuffer.split("\n");
    this.readBuffer = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch {
        /* ignore malformed */
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>) {
    // Command response
    if (typeof msg.request_id === "number") {
      const req = this.pending.get(msg.request_id);
      if (req) {
        clearTimeout(req.timer);
        this.pending.delete(msg.request_id);
        if (msg.error === "success") {
          req.resolve(msg.data ?? null);
        } else {
          req.reject(new Error(String(msg.error)));
        }
      }
    }

    // Property changes
    if (msg.event === "property-change") {
      if (msg.name === "time-pos" && typeof msg.data === "number") {
        this._positionMs = Math.round(msg.data * 1000);
        this.emit("progress", this._positionMs, this._durationMs);
      } else if (msg.name === "duration" && typeof msg.data === "number") {
        this._durationMs = Math.round(msg.data * 1000);
        this.emit("stateChange", this.getStatus());
      } else if (msg.name === "pause" && typeof msg.data === "boolean") {
        this._isPaused = msg.data;
        this.emit("stateChange", this.getStatus());
      }
    }

    if (msg.event === "start-file") {
      this._isPaused = false;
      this._positionMs = 0;
      this._durationMs = 0;
      this.emit("stateChange", this.getStatus());
    }

    if (msg.event === "end-file") {
      const reason = String(msg.reason ?? "");
      const wasPlaying = this._filePath;
      this._positionMs = 0;
      this._durationMs = 0;
      this._isPaused = false;
      if (reason !== "stop" && reason !== "quit") {
        // Only clear filePath on natural end / error, not on programmatic stop
        // (stop() already cleared it optimistically)
        this._filePath = null;
      }
      this.emit("stateChange", this.getStatus());
      if (reason === "eof" && wasPlaying) this.emit("ended");
      if (reason === "error")
        this.emit(
          "error",
          new Error(`mpv playback error: ${String(msg.file_error ?? "unknown")}`),
        );
    }
  }

  private async observeProperties() {
    await this.sendCommand(["observe_property", 1, "time-pos"]);
    await this.sendCommand(["observe_property", 2, "duration"]);
    await this.sendCommand(["observe_property", 3, "pause"]);
  }

  // ── IPC command ──────────────────────────────────────────────────────

  private sendCommand(cmd: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("mpv not connected"));
        return;
      }
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mpv command timed out: ${String(cmd[0])}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ command: cmd, request_id: id }) + "\n");
    });
  }

  // ── Public API ───────────────────────────────────────────────────────

  async play(filePath: string): Promise<void> {
    await this.ensureStarted();
    this._filePath = filePath;
    this._positionMs = 0;
    this._durationMs = 0;
    this._isPaused = false;
    this.emit("stateChange", this.getStatus());
    await this.sendCommand(["loadfile", filePath, "replace"]);
  }

  async stop(): Promise<void> {
    if (!this._started || !this._filePath) return;
    this._filePath = null;
    this._positionMs = 0;
    this._durationMs = 0;
    this._isPaused = false;
    this.emit("stateChange", this.getStatus());
    await this.sendCommand(["stop"]);
  }

  async togglePause(): Promise<void> {
    if (!this._started) return;
    await this.sendCommand(["cycle", "pause"]);
  }

  async seekMs(ms: number): Promise<void> {
    if (!this._started) return;
    await this.sendCommand(["seek", ms / 1000, "absolute+exact"]);
  }

  async setVolume(percent: number): Promise<void> {
    await this.ensureStarted();
    await this.sendCommand(["set_property", "volume", Math.round(percent)]);
  }

  getStatus(): PlayerStatus {
    return {
      isPlaying: this._started && this._filePath !== null && !this._isPaused,
      isPaused: this._isPaused,
      positionMs: this._positionMs,
      durationMs: this._durationMs,
      filePath: this._filePath,
    };
  }

  async quit(): Promise<void> {
    if (!this._started) return;
    try {
      await this.sendCommand(["quit"]);
    } catch {
      /* ignore */
    }
    this.socket?.destroy();
    this.socket = null;
    this._started = false;
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

let _instance: MpvPlayer | null = null;

export function getInstance(): MpvPlayer {
  if (!_instance) _instance = new MpvPlayer();
  return _instance;
}
