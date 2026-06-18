import { createRequire } from "node:module";

// Local type definitions for spotify-url-info (v3.3.0)
// The package ships CJS with a callable module.exports; the type declaration
// exports the interface as the default type which causes TS2693 when used
// as a value, so we declare the shape manually here.

export interface SpotifyUrlInfoTrack {
    artist: string;
    duration?: number;
    name: string;
    previewUrl?: string;
    uri: string;
}

export interface SpotifyUrlInfoPreview {
    date: string | null;
    title: string;
    type: string;
    track: string;
    description?: string;
    artist: string;
    image?: string;
    audio?: string;
    link: string;
    embed: string;
}

export interface Details {
    preview: SpotifyUrlInfoPreview;
    tracks: SpotifyUrlInfoTrack[];
}

interface SpotifyUrlInfoApi {
    getDetails: (url: string, opts?: RequestInit) => Promise<Details>;
}

// The package is CJS-only with an awkward default export type (see note above), so we bridge it
// via createRequire — a plain ESM `import` would crash at runtime ("require is not defined") under
// this project's `"type": "module"`, and a default import would trip TS2693.
const require = createRequire(import.meta.url);
const createSpotifyUrlInfo = require("spotify-url-info") as (fetch: typeof globalThis.fetch) => SpotifyUrlInfoApi;

const api: SpotifyUrlInfoApi = createSpotifyUrlInfo(fetch);

export function getSpotifyEmbedDetails(url: string): Promise<Details> {
    return api.getDetails(url);
}
