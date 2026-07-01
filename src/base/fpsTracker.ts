export interface FpsStats {
    fps: number;
    minFps: number;
    maxFps: number;
    renderMs: number;
}

type Subscriber = (stats: FpsStats) => void;

const EMPTY: FpsStats = { fps: 0, minFps: 0, maxFps: 0, renderMs: 0 };

class FpsTracker {
    private timestamps: number[] = [];
    private fps = 0;
    private minFps = Infinity;
    private maxFps = 0;
    private renderMs = 0;
    private hasFirstFrame = false;
    private lastNotify = 0;
    private subscribers = new Set<Subscriber>();

    recordFrame(renderTimeMs: number): void {
        const now = performance.now();
        this.timestamps.push(now);
        const cutoff = now - 1000;
        while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
            this.timestamps.shift();
        }
        this.fps = this.timestamps.length;

        // EMA on render time; seed with first frame to avoid low-ball start.
        this.renderMs = this.hasFirstFrame ? this.renderMs * 0.8 + renderTimeMs * 0.2 : renderTimeMs;
        this.hasFirstFrame = true;

        // Only track min/max when the app is actively rendering.
        if (this.fps > 0) {
            if (this.fps < this.minFps) this.minFps = this.fps;
            if (this.fps > this.maxFps) this.maxFps = this.fps;
        }

        // Throttle subscriber notifications to 4×/s so the counter itself
        // doesn't add frames to the measurement.
        if (now - this.lastNotify >= 250) {
            this.lastNotify = now;
            this.notify();
        }
    }

    /** Reset counters — call when the stats overlay is opened for a fresh reading. */
    reset(): void {
        this.timestamps = [];
        this.fps = 0;
        this.minFps = Infinity;
        this.maxFps = 0;
        this.renderMs = 0;
        this.hasFirstFrame = false;
        this.lastNotify = 0;
        this.notify();
    }

    getStats(): FpsStats {
        return {
            fps: this.fps,
            minFps: this.minFps === Infinity ? 0 : this.minFps,
            maxFps: this.maxFps,
            renderMs: this.renderMs,
        };
    }

    subscribe(fn: Subscriber): () => void {
        this.subscribers.add(fn);
        return () => this.subscribers.delete(fn);
    }

    private notify(): void {
        const stats = this.getStats();
        this.subscribers.forEach((fn) => fn(stats));
    }
}

export const fpsTracker = new FpsTracker();
export { EMPTY as EMPTY_FPS_STATS };
