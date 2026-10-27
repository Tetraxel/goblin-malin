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
