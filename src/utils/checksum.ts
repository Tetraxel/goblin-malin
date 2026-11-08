import { createHash } from "crypto";
import { createReadStream } from "fs";
import * as fs from "fs/promises";
import { httpsGetText } from "./http";
import { globalLogger } from "#base/logger/logger";

/** A downloaded file whose SHA-256 differs from the one the vendor published. */
export class ChecksumMismatchError extends Error {
    constructor(
        readonly assetName: string,
        readonly expected: string,
        readonly actual: string
    ) {
        super(`SHA-256 of ${assetName} does not match the published checksum (expected ${expected}, got ${actual})`);
        this.name = "ChecksumMismatchError";
    }
}

/** Parse `sha256sum` output (`<64 hex>  <name>` or `<64 hex> *<name>`) into name → lowercase hash. */
export function parseChecksums(text: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const line of text.split(/\r?\n/)) {
        const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
        if (match) out.set(match[2], match[1].toLowerCase());
    }
    return out;
}

export function sha256File(file: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        createReadStream(file)
            .on("data", (chunk) => hash.update(chunk))
            .on("error", reject)
            .on("end", () => resolve(hash.digest("hex")));
    });
}

/**
 * Check `file` against the checksum list the vendor publishes at `checksumsUrl`.
 *
 * Best effort by design: if the list can't be fetched or doesn't mention `assetName`, we say so in
 * the log and carry on (`"unverified"`) — an unreachable checksum file must not stop the app from
 * working, and the download itself already came over https. A checksum that *is* published and
 * doesn't match is different: the file is deleted and a `ChecksumMismatchError` is thrown.
 */
export async function verifyAgainstPublishedChecksums(
    file: string,
    checksumsUrl: string,
    assetName: string,
    userAgent: string
): Promise<"verified" | "unverified"> {
    let expected: string | undefined;
    try {
        expected = parseChecksums(await httpsGetText(checksumsUrl, { userAgent })).get(assetName);
    } catch (error) {
        globalLogger.warn(
            `Could not fetch checksums for ${assetName}, so it is not verified: ${error instanceof Error ? error.message : error}`
        );
        return "unverified";
    }
    if (!expected) {
        globalLogger.warn(`No published checksum for ${assetName} in ${checksumsUrl}; not verified`);
        return "unverified";
    }

    const actual = await sha256File(file);
    if (actual !== expected) {
        await fs.unlink(file).catch(() => {});
        throw new ChecksumMismatchError(assetName, expected, actual);
    }
    globalLogger.debug(`SHA-256 of ${assetName} verified`);
    return "verified";
}
