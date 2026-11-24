import { getInstance } from "#utils/mpvPlayer";
import { playFrom, togglePlayback } from "#utils/togglePlayback";

/**
 * Playing one layer of a track (the track or a stem) on the app's preview player, from a stem's cell in the Stems
 * view. Starting another layer of the same track while one plays goes on from the same second. The Stems tab plays
 * the layers together instead (`stemMixer.ts`).
 */
export function playLayer(file: string, files: readonly (string | undefined)[]): void {
    const status = getInstance().getStatus();
    const current =
        status.filePath && (status.isPlaying || status.isPaused) && files.includes(status.filePath)
            ? status.filePath
            : undefined;
    if (!current || current === file) {
        togglePlayback(file);
        return;
    }
    playFrom(file, status.positionMs);
}
