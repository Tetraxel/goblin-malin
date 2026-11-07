import { useEffect, useState } from "react";
import { getInstance, PlayerStatus } from "#utils/mpvPlayer";

export interface FilePlayback {
    isPlaying: boolean;
    isPaused: boolean;
    positionMs: number;
    durationMs: number;
}

const IDLE: FilePlayback = { isPlaying: false, isPaused: false, positionMs: 0, durationMs: 0 };

/**
 * What the app-wide player is doing with `filePath`: idle unless that exact file is the loaded one.
 * Playback is intentionally never stopped from here, so music keeps going while you move around.
 */
export function useFilePlayback(filePath: string | null): FilePlayback {
    const [state, setState] = useState<FilePlayback>(IDLE);

    useEffect(() => {
        const player = getInstance();

        function syncFromStatus(status: PlayerStatus) {
            if (status.filePath !== filePath) {
                setState(IDLE);
                return;
            }
            setState({
                isPlaying: status.isPlaying,
                isPaused: status.isPaused,
                positionMs: status.positionMs,
                durationMs: status.durationMs,
            });
        }

        const onProgress = (positionMs: number, durationMs: number) => {
            if (player.getStatus().filePath === filePath) {
                setState((prev) => ({ ...prev, positionMs, durationMs }));
            }
        };
        const onStateChange = (status: PlayerStatus) => syncFromStatus(status);
        const onEnded = () => setState(IDLE);

        player.on("progress", onProgress);
        player.on("stateChange", onStateChange);
        player.on("ended", onEnded);
        syncFromStatus(player.getStatus());

        return () => {
            player.off("progress", onProgress);
            player.off("stateChange", onStateChange);
            player.off("ended", onEnded);
        };
    }, [filePath]);

    return state;
}
