// @ts-nocheck
/**
 * spotify-url-info smoke test.
 *
 * Quick check of what https://www.npmjs.com/package/spotify-url-info returns for a Spotify URL.
 * The package scrapes Spotify's public embed page (no API key / auth needed) and exposes:
 *   getPreview(url)  → { title, type, track, artist, image, audio, link, date, ... }
 *   getTracks(url)   → [{ name, artist, duration, previewUrl, uri }, ...]
 *   getData(url)     → the full raw entity object (large)
 *   getDetails(url)  → { preview, tracks }
 *   getLink(data)    → open.spotify.com URL from a data object
 *
 * The module is a CJS factory that takes a fetch implementation; Node 18+ has a global `fetch`.
 *
 * Run:   yarn test:spotify-url-info [url]
 *        node scripts/spotify-url-info-test.mjs [url]
 * Default URL is taken from the first CLI arg, else the first Spotify track in inputs.txt,
 * else a hardcoded fallback.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createSpotifyUrlInfo from "spotify-url-info";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const FALLBACK_URL = "https://open.spotify.com/track/4v7kKFlEDmpVToHOICsXaM";

function firstUrlFromInputs() {
    const p = path.join(ROOT, "inputs.txt");
    if (!fs.existsSync(p)) return null;
    return (
        fs
            .readFileSync(p, "utf8")
            .split(/\r?\n/)
            .map((l) => l.trim().split(/\s+/)[0])
            .find((l) => /^https?:\/\/open\.spotify\.com\//.test(l)) ?? null
    );
}

const url = process.argv[2] || firstUrlFromInputs() || FALLBACK_URL;

// Node 18+ exposes a global fetch; that's all the package needs.
const { getPreview, getTracks, getData, getDetails } = createSpotifyUrlInfo(fetch);

function dump(label, value) {
    console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
    console.dir(value, { depth: null, colors: true });
}

(async () => {
    console.log(`Testing spotify-url-info against:\n  ${url}`);

    const started = Date.now();
    const preview = await getPreview(url);
    dump("getPreview()", preview);

    const tracks = await getTracks(url);
    dump(`getTracks() — ${tracks.length} track(s)`, tracks);

    // getData() is large; show only its top-level keys so the output stays readable.
    const data = await getData(url);
    dump("getData() — top-level keys", Object.keys(data));

    console.log(`\n✅ Done in ${Date.now() - started}ms.`);
})().catch((err) => {
    console.error(`\n❌ spotify-url-info failed for ${url}:`);
    console.error(err?.stack ?? err);
    process.exit(1);
});
