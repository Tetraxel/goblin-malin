/**
 * The longest a name part may be, in UTF-8 bytes. File systems allow 255 (bytes on Linux and macOS, UTF-16 units
 * on NTFS, so a byte count is safe for all of them); what is left over holds the extension and the suffixes the
 * app adds while it works (`.saving`, `.converting`, `.tagging`, a temp file's uuid).
 */
export const MAX_NAME_BYTES = 200;

/** `value` cut to at most `maxBytes` of UTF-8, never in the middle of a character. */
function truncateToBytes(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value) <= maxBytes) return value;
    let out = "";
    let bytes = 0;
    for (const char of value) {
        const size = Buffer.byteLength(char);
        if (bytes + size > maxBytes) break;
        out += char;
        bytes += size;
    }
    return out;
}

/**
 * Makes `raw` safe to use as (a part of) a file name on any OS: control characters are removed, characters Windows
 * forbids (and `/`, which would make a sub-folder) become `_`, the length is capped, and trailing dots and spaces
 * are dropped (Windows silently removes them, so the name on disk would differ from this one). The extension is
 * not part of `raw`: add it afterwards.
 *
 * Also: the bidirectional control characters are removed (U+202E would show "gpj.exe" for "exe.jpg"), the text is put
 * in Unicode form NFC (one spelling of "é" for every platform), and a name Windows reserves for a device (`NUL`, `CON`,
 * `COM1`…, with or without an extension) gets a `_` in front, since `NUL.flac` is the null device there.
 */
export function sanitizeFileNamePart(raw: string, maxBytes: number = MAX_NAME_BYTES): string {
    const cleaned = raw
        // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/[‪-‮⁦-⁩]/g, "")
        .normalize("NFC")
        .replace(/[/\\:*?"<>|]/g, "_")
        .trim();
    const name = truncateToBytes(cleaned, maxBytes).replace(/[. ]+$/, "");
    return WINDOWS_DEVICE_NAME.test(name) ? `_${name}` : name;
}

/** The names Windows reserves, whatever follows the first dot (`aux.flac`, `Con.txt`). */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
