import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as http from "http";
import * as https from "https";
import type { IncomingMessage } from "http";
import { pipeline } from "stream/promises";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Maximum number of redirects followed before giving up (guards against loops). */
const MAX_REDIRECTS = 5;

/** Idle timeout: how long a socket may stay silent before the request is aborted. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpOptions {
    userAgent?: string;
    /** Abort when the connection is idle for this long (default 30 s). */
    timeoutMs?: number;
    maxRedirects?: number;
}

/** A request that ended with a status code other than 200, carrying the URL that actually answered. */
export class HttpError extends Error {
    constructor(
        readonly url: string,
        readonly status: number
    ) {
        super(`HTTP ${status} from ${url}`);
        this.name = "HttpError";
    }
}

/**
 * GET `url`, following redirects (301/302/303/307/308), and hand the final 200
 * response to `onResponse`. Anything else rejects with an error that names the
 * URL and the status, so the cause is readable wherever it is finally shown.
 *
 * Several hosts we depend on (GitHub in particular) answer `301` when a repository
 * is renamed or moved; not following it used to fail silently.
 */
async function getFollowingRedirects<T>(
    url: string,
    opts: HttpOptions,
    onResponse: (res: IncomingMessage) => Promise<T>
): Promise<T> {
    const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let current = url;

    for (let hop = 0; hop <= maxRedirects; hop++) {
        const parsed = new URL(current);
        const transport = parsed.protocol === "http:" ? http : https;

        const res = await new Promise<IncomingMessage>((resolve, reject) => {
            const req = transport.get(
                parsed,
                { headers: opts.userAgent ? { "User-Agent": opts.userAgent } : {} },
                resolve
            );
            req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs / 1000}s`)));
            req.on("error", (error) => reject(new Error(`Request to ${current} failed: ${error.message}`)));
        });

        const status = res.statusCode ?? 0;

        if (REDIRECT_STATUSES.has(status) && res.headers.location) {
            res.resume(); // discard the body so the socket is released
            const next = new URL(res.headers.location, parsed);
            // Never let a redirect take an https request down to plain http.
            if (parsed.protocol === "https:" && next.protocol !== "https:") {
                throw new Error(`Refusing to follow a redirect from ${current} to non-https ${next.href}`);
            }
            current = next.href;
            continue;
        }

        if (status !== 200) {
            res.resume();
            throw new HttpError(current, status);
        }

        return onResponse(res);
    }

    throw new Error(`Too many redirects (more than ${maxRedirects}) starting at ${url}`);
}

/** GET a URL and return the body as text. Follows redirects; rejects on any non-200 status. */
export async function httpsGetText(url: string, opts: HttpOptions = {}): Promise<string> {
    return getFollowingRedirects(url, opts, async (res) => {
        let data = "";
        res.setEncoding("utf8");
        for await (const chunk of res) {
            data += chunk;
        }
        return data;
    });
}

/** GET a URL and parse the body as JSON. Follows redirects; rejects on any non-200 status. */
export async function httpsGetJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
    const body = await httpsGetText(url, opts);
    try {
        return JSON.parse(body) as T;
    } catch (error) {
        throw new Error(`Response from ${url} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
}

/**
 * Download a URL to `destination`. Follows redirects, rejects on any non-200 status
 * or on a connection that drops mid-transfer, and removes the partial file on failure.
 */
export async function downloadFile(url: string, destination: string, opts: HttpOptions = {}): Promise<void> {
    try {
        await getFollowingRedirects(url, opts, (res) => pipeline(res, createWriteStream(destination)));
    } catch (error) {
        await fs.unlink(destination).catch(() => {});
        throw error;
    }
}
