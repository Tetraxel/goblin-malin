import { getInstance } from "#utils/mpvPlayer";

/**
 * Space-bar semantics for a file: pause/resume it if it's the one loaded, otherwise start it.
 * Playback is the app-wide singleton, so this works from any panel.
 */
export function togglePlayback(filePath: string): void {
    const player = getInstance();
    const status = player.getStatus();
    if (status.filePath === filePath && (status.isPlaying || status.isPaused)) {
        player.togglePause().catch(() => {});
    } else {
        player.play(filePath).catch(() => {});
    }
}

/** Plays a file from `startMs`, or seeks there when it is already the loaded one. */
export function playFrom(filePath: string, startMs: number): void {
    const player = getInstance();
    const status = player.getStatus();
    if (status.filePath === filePath && (status.isPlaying || status.isPaused)) {
        player.seekMs(startMs).catch(() => {});
    } else {
        player.play(filePath, startMs).catch(() => {});
    }
}

/**
 * A click on a playback bar's track: seek there when the file is the loaded one, otherwise start it from
 * there. `knownDurationMs` (from the file's info) is what a not-yet-loaded file's fraction is measured on.
 */
export function seekFileToFraction(filePath: string, fraction: number, knownDurationMs: number): void {
    const status = getInstance().getStatus();
    if (status.filePath === filePath && status.durationMs > 0) {
        getInstance()
            .seekMs(Math.round(fraction * status.durationMs))
            .catch(() => {});
    } else if (knownDurationMs > 0) {
        playFrom(filePath, Math.round(fraction * knownDurationMs));
    }
}
