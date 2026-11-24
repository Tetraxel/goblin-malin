import { useEffect, useState } from "react";
import { loadWaveform } from "#flows/musicDownloadFlow/utils/waveform";

/** The waveform of a file (0–1 loudness per slice), once ffmpeg has read it; `null` when it cannot be read. */
export function useWaveform(filePath: string | undefined): number[] | null | undefined {
    const [state, setState] = useState<{ path: string; peaks: number[] | null } | undefined>();
    useEffect(() => {
        if (!filePath) return;
        let current = true;
        void loadWaveform(filePath).then((peaks) => {
            if (current) setState({ path: filePath, peaks });
        });
        return () => {
            current = false;
        };
    }, [filePath]);
    return filePath && state?.path === filePath ? state.peaks : undefined;
}
