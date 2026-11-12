export const DEFAULT_HARMONY_URL = "https://harmony.pulsewidth.org.uk";

/**
 * The Harmony page that imports one release: it merges what the streaming services say, looks for a duplicate in
 * MusicBrainz, maps artists, and opens MusicBrainz' editor pre-filled. https://github.com/kellnerd/harmony
 *
 * Harmony has no documented API; this is only a link the user opens in their own browser. `base` is the public
 * instance or the user's own (http is accepted for a local one).
 */
export function harmonyReleaseUrl(base: string, albumUrl: string, barcode?: string): string {
    const root = safeBase(base) ?? DEFAULT_HARMONY_URL;
    const query = new URLSearchParams({ url: albumUrl });
    if (barcode) query.set("gtin", barcode);
    return `${root}/release?${query.toString()}`;
}

function safeBase(base: string): string | undefined {
    try {
        const url = new URL(base.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
        return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
        return undefined;
    }
}
