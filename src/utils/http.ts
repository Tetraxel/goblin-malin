import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as http from "http";
import * as https from "https";
import type { IncomingMessage } from "http";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Maximum number of redirects followed before giving up (guards against loops). */
const MAX_REDIRECTS = 5;

/** Idle timeout: how long a socket may stay silent before the request is aborted. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** What a text or JSON answer may weigh, and how long the whole of it may take. */
const DEFAULT_TEXT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TEXT_TOTAL_MS = 2 * 60_000;
/** A file download: the biggest tool archive (ffmpeg) is a few hundred megabytes. */
const DEFAULT_FILE_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_FILE_TOTAL_MS = 30 * 60_000;

export interface HttpOptions {
    userAgent?: string;
    /** Abort when the connection is idle for this long (default 30 s). */
    timeoutMs?: number;
    maxRedirects?: number;
    /** Abort when the body is bigger than this (an announced size is refused at once). */
    maxBytes?: number;
    /** Abort when the whole transfer, a trickle that never goes idle included, takes longer than this. */
    totalTimeoutMs?: number;
}

/** What watches one body: `count` is told the bytes of every chunk (and throws past the limit), `stop` ends the watch. */
interface BodyGuard {
    count(bytes: number): void;
    stop(): void;
}

/**
 * Ends a body that is announced or grows past `maxBytes`, or that lasts past `totalTimeoutMs`. The caller reports the
 * bytes it reads (a string chunk is counted as bytes, not characters): no second `data` listener is attached, so the
 * order of listeners and the tick they are added in do not matter.
 */
function limitBody(res: IncomingMessage, url: string, maxBytes: number, totalTimeoutMs: number): BodyGuard {
    const announced = Number(res.headers["content-length"]);
    if (Number.isFinite(announced) && announced > maxBytes) {
        res.destroy(new Error(`${url} is ${announced} bytes, more than the ${maxBytes} allowed`));
        return { count: () => {}, stop: () => {} };
    }
    let received = 0;
    const timer = setTimeout(
        () => res.destroy(new Error(`${url} took more than ${Math.round(totalTimeoutMs / 1000)}s`)),
        totalTimeoutMs
    );
    return {
        count(bytes) {
            received += bytes;
            if (received > maxBytes) {
                const error = new Error(`${url} sent more than the ${maxBytes} bytes allowed`);
                res.destroy(error);
                throw error;
            }
        },
        stop: () => clearTimeout(timer),
    };
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
    onResponse: (res: IncomingMessage, guard: BodyGuard) => Promise<T>,
    limits: { maxBytes: number; totalTimeoutMs: number }
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

        const guard = limitBody(
            res,
            current,
            opts.maxBytes ?? limits.maxBytes,
            opts.totalTimeoutMs ?? limits.totalTimeoutMs
        );
        try {
            return await onResponse(res, guard);
        } finally {
            guard.stop();
        }
    }

    throw new Error(`Too many redirects (more than ${maxRedirects}) starting at ${url}`);
}

/** GET a URL and return the body as text. Follows redirects; rejects on any non-200 status. */
export async function httpsGetText(url: string, opts: HttpOptions = {}): Promise<string> {
    return getFollowingRedirects(
        url,
        opts,
        async (res, guard) => {
            // Bytes, decoded once at the end: a multi-byte character cut between two chunks stays whole.
            const chunks: Buffer[] = [];
            for await (const chunk of res as AsyncIterable<Buffer>) {
                guard.count(chunk.length);
                chunks.push(chunk);
            }
            return Buffer.concat(chunks).toString("utf8");
        },
        { maxBytes: DEFAULT_TEXT_MAX_BYTES, totalTimeoutMs: DEFAULT_TEXT_TOTAL_MS }
    );
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
        await getFollowingRedirects(
            url,
            opts,
            (res, guard) => {
                const counter = new Transform({
                    transform(chunk: Buffer, _encoding, callback) {
                        try {
                            guard.count(chunk.length);
                            callback(null, chunk);
                        } catch (error) {
                            callback(error as Error);
                        }
                    },
                });
                return pipeline(res, counter, createWriteStream(destination));
            },
            { maxBytes: DEFAULT_FILE_MAX_BYTES, totalTimeoutMs: DEFAULT_FILE_TOTAL_MS }
        );
    } catch (error) {
        await fs.unlink(destination).catch(() => {});
        throw error;
    }
}
