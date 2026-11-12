import { useEffect, useState } from "react";
import * as fs from "fs";

/** How often a file shown on screen is looked for again (it may be deleted, or its drive plugged back in). */
const RECHECK_MS = 3000;

/**
 * Whether the file at `filePath` is on disk right now: `undefined` until the first look, and for no path.
 * It looks again every few seconds while mounted, so a file deleted behind the app's back is noticed, and one that
 * comes back (a drive plugged in again, a relocated path) stops being reported as lost.
 */
export function useFileExists(filePath: string | null | undefined): boolean | undefined {
    const [state, setState] = useState<{ path: string; exists: boolean } | null>(null);

    useEffect(() => {
        if (!filePath) return;
        let current = true;
        const look = () => {
            fs.promises.access(filePath).then(
                () =>
                    current &&
                    setState((prev) =>
                        prev?.path === filePath && prev.exists ? prev : { path: filePath, exists: true }
                    ),
                () =>
                    current &&
                    setState((prev) =>
                        prev?.path === filePath && !prev.exists ? prev : { path: filePath, exists: false }
                    )
            );
        };
        look();
        const timer = setInterval(look, RECHECK_MS);
        return () => {
            current = false;
            clearInterval(timer);
        };
    }, [filePath]);

    // A result for another path is not an answer for this one.
    return filePath && state?.path === filePath ? state.exists : undefined;
}
