/**
 * Marking download sources whose file is gone, so the UI says "File not found" instead of offering a file that
 * is not there (play, save and the preview all key off `localFile.state`). The temporary stems of a separation run
 * (`stemRuns[].stems[]`, P33) are temporary files too and are marked the same way.
 *
 * Works on anything shaped like a task snapshot — a stored session's, or a live task's `{ attributes }` — and
 * never on a class instance, so it is as happy with JSON read from `sessions.json` as with revived tasks.
 */

type MaybeSource = { localFile?: { state?: string; path?: unknown } };
type MaybeStemFile = { state?: string; path?: unknown };
type MaybeStemRun = { stems?: MaybeStemFile[] };
type MaybeTrackAttributes = { downloadSources?: MaybeSource[]; stemRuns?: MaybeStemRun[] };

/**
 * Every temporary file a snapshot uses: its download sources' `localFile.path` and its stem runs' files (none for a
 * collection or a task without either).
 */
export function localFilePaths(attributes: unknown): string[] {
    const attrs = attributes as MaybeTrackAttributes | undefined;
    const paths: string[] = [];
    const sources = attrs?.downloadSources;
    if (Array.isArray(sources)) {
        for (const source of sources) {
            const p = source?.localFile?.path;
            if (typeof p === "string" && p) paths.push(p);
        }
    }
    const runs = attrs?.stemRuns;
    if (Array.isArray(runs)) {
        for (const run of runs) {
            if (!Array.isArray(run?.stems)) continue;
            for (const stem of run.stems) {
                if (typeof stem?.path === "string" && stem.path) paths.push(stem.path);
            }
        }
    }
    return paths;
}

/** The stem runs with `state = "not_found"` on every stem `isMissing` reports gone; the same array when unchanged. */
function markMissingStems(runs: MaybeStemRun[], isMissing: (filePath: string) => boolean): MaybeStemRun[] {
    let changed = false;
    const next = runs.map((run) => {
        if (!Array.isArray(run?.stems)) return run;
        let runChanged = false;
        const stems = run.stems.map((stem) => {
            if (stem?.state !== "found" || typeof stem.path !== "string" || !isMissing(stem.path)) return stem;
            runChanged = true;
            return { ...stem, state: "not_found" };
        });
        if (!runChanged) return run;
        changed = true;
        return { ...run, stems };
    });
    return changed ? next : runs;
}

/**
 * The same attributes with `localFile.state = "not_found"` on every source (and `state = "not_found"` on every stem)
 * whose file `isMissing` reports gone. Returns the very same object when nothing changes, so callers can tell
 * cheaply whether to write.
 */
export function markMissingInAttributes<A>(attributes: A, isMissing: (filePath: string) => boolean): A {
    const attrs = attributes as MaybeTrackAttributes | undefined;
    let result: MaybeTrackAttributes | undefined = attrs;

    const sources = attrs?.downloadSources;
    if (Array.isArray(sources)) {
        let changed = false;
        const next = sources.map((source) => {
            const file = source?.localFile;
            if (file?.state !== "found" || typeof file.path !== "string" || !isMissing(file.path)) return source;
            changed = true;
            return { ...source, localFile: { ...file, state: "not_found" } };
        });
        if (changed) result = { ...result, downloadSources: next };
    }

    const runs = attrs?.stemRuns;
    if (Array.isArray(runs)) {
        const next = markMissingStems(runs, isMissing);
        if (next !== runs) result = { ...result, stemRuns: next };
    }

    return result === attrs ? attributes : (result as A);
}

/** `markMissingInAttributes` for a whole snapshot (`{ attributes }`); the same object back when unchanged. */
export function markMissingInSnapshot<S extends { attributes?: unknown }>(
    snapshot: S,
    isMissing: (filePath: string) => boolean
): S {
    const attributes = markMissingInAttributes(snapshot.attributes, isMissing);
    return attributes === snapshot.attributes ? snapshot : { ...snapshot, attributes };
}
