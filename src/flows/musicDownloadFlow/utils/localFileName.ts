import { LocalFile } from "../types";

/**
 * The file name (with extension) shown for a downloaded file. `LocalFile.name` is only the stem, so
 * showing it alone makes a `.flac` look like an extension-less file. It is deliberately not the
 * basename of `path`: downloads sit in a temp folder under a unique (uuid) name.
 */
export function localFileName(file: LocalFile): string {
    return `${file.name}.${file.extension}`;
}
