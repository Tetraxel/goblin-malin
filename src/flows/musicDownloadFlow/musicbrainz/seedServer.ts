import * as crypto from "crypto";
import * as http from "http";
import { type AddressInfo } from "net";
import { MBID_PATTERN } from "./thresholds";
import { MUSICBRAINZ_ADD_RELEASE_URL, type SeedField } from "./buildReleaseSeed";

/**
 * A one-shot web server on 127.0.0.1 that hands the browser a pre-filled MusicBrainz "Add release" form and catches
 * the redirect MusicBrainz sends after the user pressed "Enter edit" (it appends `release_mbid`).
 *
 * Why a server at all: the editor can only be seeded by a POST, and a browser can only POST from a page. The page
 * is served from here, auto-submits to MusicBrainz, and MusicBrainz's own confirmation page (always shown for a
 * cross-site POST) and editor take over — the user reviews and submits, never this code.
 *
 * Locked down on purpose: loopback only, a random token in every path, the Host header must be ours (no DNS
 * rebinding), exactly two routes, and it closes on the redirect, on `close()`, or after a timeout.
 */
export type SeedOutcome =
    | { reason: "added"; releaseMbid: string }
    /** The redirect came back without a usable release id (e.g. the user abandoned the edit). */
    | { reason: "returned" }
    | { reason: "timeout" }
    | { reason: "closed" };

export type SeedSession = {
    /** Open this in the user's browser. */
    url: string;
    outcome: Promise<SeedOutcome>;
    close: () => void;
};

export const SEED_TIMEOUT_MS = 15 * 60 * 1000;

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function renderSeedPage(fields: readonly SeedField[], target: string = MUSICBRAINZ_ADD_RELEASE_URL): string {
    const inputs = fields
        .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
        .join("\n      ");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opening MusicBrainz…</title>
<style>body{font:16px system-ui,sans-serif;margin:3rem auto;max-width:34rem;padding:0 1rem;color:#222}</style></head>
<body onload="document.forms[0].submit()">
  <h1>Opening MusicBrainz…</h1>
  <p>Goblin Malin is sending the release data to the MusicBrainz editor. You review it there and decide whether to submit it.</p>
  <form method="post" action="${escapeHtml(target)}">
      ${inputs}
      <noscript><button type="submit">Continue to MusicBrainz</button></noscript>
  </form>
</body></html>`;
}

function donePage(added: boolean): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Goblin Malin</title>
<style>body{font:16px system-ui,sans-serif;margin:3rem auto;max-width:34rem;padding:0 1rem;color:#222}</style></head>
<body><h1>${added ? "Release added" : "Back to Goblin Malin"}</h1>
<p>${added ? "Goblin Malin has noted the new release." : "No release was reported."} You can close this tab and return to the terminal.</p></body></html>`;
}

export async function startSeedSession(
    buildFields: (redirectUri: string) => readonly SeedField[],
    options: { timeoutMs?: number; target?: string } = {}
): Promise<SeedSession> {
    const token = crypto.randomBytes(16).toString("hex");
    let resolveOutcome!: (outcome: SeedOutcome) => void;
    const outcome = new Promise<SeedOutcome>((resolve) => (resolveOutcome = resolve));

    let seedHtml = "";
    let origin = "";
    let finished = false;
    // Set once the server is listening; `finish` clears it. An object, not a bare `let`: it is written after `finish` exists.
    const timer: { handle?: NodeJS.Timeout } = {};

    const server = http.createServer((req, res) => {
        // One-shot: once the session is over nothing is answered, not even on a connection that is still open.
        if (finished) {
            req.socket.destroy();
            return;
        }
        const send = (status: number, body: string, type = "text/html; charset=utf-8") => {
            res.writeHead(status, {
                "Content-Type": type,
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
                // No keep-alive: each answer closes its connection, so none outlives the session.
                Connection: "close",
            });
            res.end(body);
        };
        // The browser must be talking to us by our own address (a rebinding page would carry another Host).
        if (req.headers.host !== origin.replace("http://", "") || req.method !== "GET")
            return send(404, "Not found", "text/plain");

        let url: URL;
        try {
            url = new URL(req.url ?? "/", origin);
        } catch {
            return send(404, "Not found", "text/plain");
        }
        if (url.pathname === `/seed/${token}`) return send(200, seedHtml);
        if (url.pathname === `/done/${token}`) {
            const id = url.searchParams.get("release_mbid") ?? "";
            const valid = MBID_PATTERN.test(id);
            send(200, donePage(valid));
            finish(valid ? { reason: "added", releaseMbid: id.toLowerCase() } : { reason: "returned" });
            return;
        }
        return send(404, "Not found", "text/plain");
    });

    function finish(result: SeedOutcome): void {
        if (finished) return;
        finished = true;
        if (timer.handle) clearTimeout(timer.handle);
        resolveOutcome(result);
        // Let the page we just answered finish sending before the socket goes away.
        server.close();
        server.closeIdleConnections?.();
        setTimeout(() => server.closeAllConnections?.(), 1000).unref();
    }

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    // A waiting seed session never keeps the app from quitting.
    server.unref();
    const port = (server.address() as AddressInfo).port;
    origin = `http://127.0.0.1:${port}`;
    seedHtml = renderSeedPage(buildFields(`${origin}/done/${token}`), options.target);

    timer.handle = setTimeout(() => finish({ reason: "timeout" }), options.timeoutMs ?? SEED_TIMEOUT_MS);
    timer.handle.unref();

    return { url: `${origin}/seed/${token}`, outcome, close: () => finish({ reason: "closed" }) };
}
