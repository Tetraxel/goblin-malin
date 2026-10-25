import { useEffect, useState } from "react";
import { getInstance, PlayerStatus } from "#utils/mpvPlayer";

export type NowPlaying = { filePath: string; isPaused: boolean } | null;

function toNowPlaying(status: PlayerStatus): NowPlaying {
    return status.filePath ? { filePath: status.filePath, isPaused: status.isPaused } : null;
}

/**
 * What the shared player is playing right now. Deliberately ignores the per-tick
 * `progress` events, so consumers re-render only when the track or its paused
 * state changes — not several times a second while music plays.
 */
export function useNowPlaying(): NowPlaying {
    const [nowPlaying, setNowPlaying] = useState<NowPlaying>(() => toNowPlaying(getInstance().getStatus()));

    useEffect(() => {
        const player = getInstance();
        const sync = (status: PlayerStatus) => {
            const next = toNowPlaying(status);
            setNowPlaying((prev) =>
                prev?.filePath === next?.filePath && prev?.isPaused === next?.isPaused ? prev : next
            );
        };
        player.on("stateChange", sync);
        sync(player.getStatus());
        return () => {
            player.off("stateChange", sync);
        };
    }, []);

    return nowPlaying;
}
