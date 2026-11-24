import { getMixer, type MixerStatus } from "#utils/mpvMixer";
import { getInstance as getPreviewPlayer } from "#utils/mpvPlayer";
import { globalLogger } from "#base/logger/logger";
import { type StemLayer } from "./stemFiles";

/**
 * The Stems tab's player (P33): the track and its stems played together as one mix (`MpvMixer`), with a mute and a
 * solo per layer. By default every stem plays and the track itself is muted (the stems add up to it); a solo plays
 * only the soloed layers. The mute / solo choices are per track and last as long as the app runs.
 *
 * The app's preview player (one file, Space in the Download Sources tab) and the mixer never play together: starting
 * one pauses the other.
 */
export type LayerMix = { muted: ReadonlySet<string>; soloed: ReadonlySet<string> };

const DEFAULT_MIX: LayerMix = { muted: new Set(["original"]), soloed: new Set() };

/** Whether a layer is heard in the mix. */
export function isAudible(mix: LayerMix, key: string): boolean {
    return mix.soloed.size > 0 ? mix.soloed.has(key) : !mix.muted.has(key);
}

/** The gain of each layer with a file, in order. */
export function gainsOf(mix: LayerMix, layers: readonly StemLayer[]): number[] {
    return layers.filter((l) => l.path).map((l) => (isAudible(mix, l.key) ? 1 : 0));
}

export type StemPlayerSnapshot = {
    /** The track whose layers are loaded in the mixer, if any. */
    taskId?: string;
    status: MixerStatus;
    mixes: ReadonlyMap<string, LayerMix>;
};

/** Updates of the position reach the screen at most this often: every one repaints the whole screen. */
const POSITION_INTERVAL_MS = 250;

class StemPlayer {
    private taskId?: string;
    private layers: StemLayer[] = [];
    private mixes = new Map<string, LayerMix>();
    private snapshot: StemPlayerSnapshot = { status: getMixer().getStatus(), mixes: this.mixes };
    private listeners = new Set<() => void>();
    private lastEmit = 0;
    private pending?: NodeJS.Timeout;
    private wired = false;

    private wire(): void {
        if (this.wired) return;
        this.wired = true;
        const mixer = getMixer();
        mixer.on("change", (status: MixerStatus) => {
            const before = this.snapshot.status;
            // Only the position ticks: throttled. Anything else (loaded, paused, length) at once.
            const onlyPosition =
                before.loaded === status.loaded &&
                before.paused === status.paused &&
                before.durationMs === status.durationMs &&
                before.files === status.files;
            this.publish(onlyPosition);
        });
        // The preview starts: the mix pauses (two players over each other is noise).
        getPreviewPlayer().on("stateChange", (status: { isPlaying: boolean }) => {
            const mixer = getMixer();
            if (status.isPlaying && mixer.getStatus().loaded && !mixer.getStatus().paused) void mixer.setPaused(true);
        });
    }

    private publish(throttle: boolean): void {
        const emit = () => {
            this.pending = undefined;
            this.lastEmit = Date.now();
            this.snapshot = { taskId: this.taskId, status: getMixer().getStatus(), mixes: this.mixes };
            for (const listener of this.listeners) listener();
        };
        if (!throttle) {
            clearTimeout(this.pending);
            emit();
            return;
        }
        if (this.pending) return;
        const wait = POSITION_INTERVAL_MS - (Date.now() - this.lastEmit);
        if (wait <= 0) emit();
        else this.pending = setTimeout(emit, wait);
    }

    subscribe = (listener: () => void): (() => void) => {
        this.wire();
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getSnapshot = (): StemPlayerSnapshot => this.snapshot;

    mixOf(taskId: string): LayerMix {
        return this.mixes.get(taskId) ?? DEFAULT_MIX;
    }

    /** Whether the mixer holds this track's layers (playing or paused). */
    isLoaded(taskId: string): boolean {
        return this.taskId === taskId && getMixer().getStatus().loaded;
    }

    private files(layers: readonly StemLayer[]): string[] {
        return layers.filter((l) => l.path).map((l) => l.path!);
    }

    /** Loads the track's layers into the mixer (from `startMs`), unless they are there already with the same files. */
    private async ensureLoaded(
        taskId: string,
        layers: StemLayer[],
        startMs: number,
        paused: boolean
    ): Promise<boolean> {
        const files = this.files(layers);
        if (files.length === 0) return false;
        const status = getMixer().getStatus();
        const same =
            this.taskId === taskId &&
            status.loaded &&
            status.files.length === files.length &&
            status.files.every((f, i) => f === files[i]);
        if (same) return true;
        this.taskId = taskId;
        this.layers = layers;
        // The preview stops: the mix takes over the speakers.
        await getPreviewPlayer()
            .stop()
            .catch(() => {});
        await getMixer().load(files, gainsOf(this.mixOf(taskId), layers), startMs, paused);
        this.publish(false);
        return false;
    }

    /** The main play / pause of the track's layers. */
    async togglePlay(taskId: string, layers: StemLayer[]): Promise<void> {
        try {
            const wasLoaded = await this.ensureLoaded(taskId, layers, 0, false);
            if (!wasLoaded) return;
            const status = getMixer().getStatus();
            if (status.paused && status.durationMs > 0 && status.positionMs >= status.durationMs - 250) {
                await getMixer().seekMs(0);
            }
            await getMixer().setPaused(!status.paused);
        } catch (error) {
            globalLogger.warn("The stem player could not play", { error });
        }
    }

    /** Plays the track's layers from `fraction` of their length (a click on a waveform). */
    async seekTo(taskId: string, layers: StemLayer[], fraction: number, knownDurationMs: number): Promise<void> {
        const status = getMixer().getStatus();
        const length = (this.taskId === taskId && status.durationMs) || knownDurationMs;
        const target = Math.round(fraction * length);
        const wasLoaded = await this.ensureLoaded(taskId, layers, target, false);
        if (wasLoaded) {
            await getMixer().seekMs(target);
            if (getMixer().getStatus().paused) await getMixer().setPaused(false);
        }
    }

    /** Shift+← / →: moves the mix by `deltaMs` while it is this track's. */
    async seekBy(taskId: string, deltaMs: number): Promise<void> {
        if (!this.isLoaded(taskId)) return;
        const status = getMixer().getStatus();
        await getMixer().seekMs(Math.min(status.durationMs || Infinity, status.positionMs + deltaMs));
    }

    private async setMix(taskId: string, mix: LayerMix): Promise<void> {
        this.mixes = new Map(this.mixes).set(taskId, mix);
        this.publish(false);
        if (this.isLoaded(taskId)) await getMixer().setGains(gainsOf(mix, this.layers));
    }

    toggleMute(taskId: string, key: string): Promise<void> {
        const mix = this.mixOf(taskId);
        const muted = new Set(mix.muted);
        if (muted.has(key)) muted.delete(key);
        else muted.add(key);
        return this.setMix(taskId, { muted, soloed: mix.soloed });
    }

    toggleSolo(taskId: string, key: string): Promise<void> {
        const mix = this.mixOf(taskId);
        const soloed = new Set(mix.soloed);
        if (soloed.has(key)) soloed.delete(key);
        else soloed.add(key);
        return this.setMix(taskId, { muted: mix.muted, soloed });
    }

    /** The layers changed (another stem picked, one saved): a mix playing them is reloaded where it was. */
    async layersChanged(taskId: string, layers: StemLayer[]): Promise<void> {
        if (!this.isLoaded(taskId)) return;
        const files = this.files(layers);
        const status = getMixer().getStatus();
        if (status.files.length === files.length && status.files.every((f, i) => f === files[i])) {
            this.layers = layers;
            return;
        }
        await this.ensureLoaded(taskId, layers, status.positionMs, status.paused);
    }
}

export const stemPlayer = new StemPlayer();
