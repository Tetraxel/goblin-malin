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

/** The vendor's checksum could not be had, and the caller does not accept a download it cannot check. */
export class ChecksumUnavailableError extends Error {
    constructor(
        readonly assetName: string,
        reason: string
    ) {
        super(`${assetName} was downloaded but could not be verified: ${reason}`);
        this.name = "ChecksumUnavailableError";
    }
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
 * By default best effort: if the list can't be fetched or doesn't mention `assetName`, we say so in the log
 * and carry on (`"unverified"`). With `required`, that is a failure instead (the file is deleted and a
 * `ChecksumUnavailableError` thrown): an executable that is going to be run must not be taken on trust. A
 * checksum that *is* published and doesn't match always deletes the file and throws a `ChecksumMismatchError`.
 */
export async function verifyAgainstPublishedChecksums(
    file: string,
    checksumsUrl: string,
    assetName: string,
    userAgent: string,
    options: { required?: boolean } = {}
): Promise<"verified" | "unverified"> {
    const unverified = async (reason: string): Promise<"unverified"> => {
        if (options.required) {
            await fs.unlink(file).catch(() => {});
            throw new ChecksumUnavailableError(assetName, reason);
        }
        globalLogger.warn(`${assetName} is not verified: ${reason}`);
        return "unverified";
    };

    let expected: string | undefined;
    try {
        expected = parseChecksums(await httpsGetText(checksumsUrl, { userAgent })).get(assetName);
    } catch (error) {
        return unverified(`the checksums could not be fetched (${error instanceof Error ? error.message : error})`);
    }
    if (!expected) return unverified(`no published checksum for it in ${checksumsUrl}`);

    const actual = await sha256File(file);
    if (actual !== expected) {
        await fs.unlink(file).catch(() => {});
        throw new ChecksumMismatchError(assetName, expected, actual);
    }
    globalLogger.debug(`SHA-256 of ${assetName} verified`);
    return "verified";
}
