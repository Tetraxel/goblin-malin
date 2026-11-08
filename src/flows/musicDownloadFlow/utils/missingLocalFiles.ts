/**
 * Marking download sources whose file is gone, so the UI says "File not found" instead of offering a file that
 * is not there (play, save and the preview all key off `localFile.state`).
 *
 * Works on anything shaped like a task snapshot — a stored session's, or a live task's `{ attributes }` — and
 * never on a class instance, so it is as happy with JSON read from `sessions.json` as with revived tasks.
 */

type MaybeSource = { localFile?: { state?: string; path?: unknown } };
type MaybeTrackAttributes = { downloadSources?: MaybeSource[] };

/** Every `localFile.path` of a snapshot's download sources (none for a collection or a task without sources). */
export function localFilePaths(attributes: unknown): string[] {
    const sources = (attributes as MaybeTrackAttributes | undefined)?.downloadSources;
    if (!Array.isArray(sources)) return [];
    const paths: string[] = [];
    for (const source of sources) {
        const p = source?.localFile?.path;
        if (typeof p === "string" && p) paths.push(p);
    }
    return paths;
}

/**
 * The same attributes with `localFile.state = "not_found"` on every source whose file `isMissing` reports gone.
 * Returns the very same object when nothing changes, so callers can tell cheaply whether to write.
 */
export function markMissingInAttributes<A>(attributes: A, isMissing: (filePath: string) => boolean): A {
    const sources = (attributes as MaybeTrackAttributes | undefined)?.downloadSources;
    if (!Array.isArray(sources)) return attributes;

    let changed = false;
    const next = sources.map((source) => {
        const file = source?.localFile;
        if (file?.state !== "found" || typeof file.path !== "string" || !isMissing(file.path)) return source;
        changed = true;
        return { ...source, localFile: { ...file, state: "not_found" } };
    });
    return changed ? ({ ...attributes, downloadSources: next } as A) : attributes;
}

/** `markMissingInAttributes` for a whole snapshot (`{ attributes }`); the same object back when unchanged. */
export function markMissingInSnapshot<S extends { attributes?: unknown }>(
    snapshot: S,
    isMissing: (filePath: string) => boolean
): S {
    const attributes = markMissingInAttributes(snapshot.attributes, isMissing);
    return attributes === snapshot.attributes ? snapshot : { ...snapshot, attributes };
}
