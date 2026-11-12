import { type ProviderArtist } from "./types";

/** Lower-case, accent-free, punctuation-free, single-spaced: "Beyoncé — Halo!" and "beyonce halo" compare equal. */
export function normalizeText(text: string | undefined): string {
    if (!text) return "";
    return text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

export function sameText(a: string | undefined, b: string | undefined): boolean {
    const na = normalizeText(a);
    return na !== "" && na === normalizeText(b);
}

/**
 * Barcodes compare by their digits, without leading zeros: a 12-digit UPC and the same code as a 13-digit EAN
 * (one leading zero) are the same barcode.
 */
export function normalizeBarcode(barcode: string | null | undefined): string {
    return (barcode ?? "").replace(/\D+/g, "").replace(/^0+/, "");
}

/**
 * A URL reduced to what identifies the page, so the same album compares equal however it was copied:
 * no scheme difference, no `www.`, no `intl-fr/` locale segment, no query or fragment, no trailing slash.
 */
export function normalizeUrl(url: string | undefined): string {
    if (!url) return "";
    try {
        const parsed = new URL(url.trim());
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        const path = parsed.pathname.replace(/^\/intl-[a-z]{2}(?:-[a-z]{2})?\//i, "/").replace(/\/+$/, "");
        return `${host}${path}`;
    } catch {
        return url.trim().toLowerCase();
    }
}

/** The canonical https form a MusicBrainz URL lookup expects, derived from a provider URL (locale and query dropped). */
export function canonicalUrl(url: string): string {
    try {
        const parsed = new URL(url.trim());
        const path = parsed.pathname.replace(/^\/intl-[a-z]{2}(?:-[a-z]{2})?\//i, "/").replace(/\/+$/, "");
        return `https://${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
    } catch {
        return url.trim();
    }
}

/** The key a user's artist decision is stored under: the provider's artist page when known, else the name. */
export function artistKey(artist: ProviderArtist): string {
    return artist.url ? `url:${normalizeUrl(artist.url)}` : `name:${normalizeText(artist.name)}`;
}

/** Whole-album total of tracks over MusicBrainz media. */
export function sumTrackCounts(media: { "track-count"?: number }[] | undefined): number | undefined {
    if (!media || media.length === 0) return undefined;
    let total = 0;
    for (const m of media) {
        if (typeof m["track-count"] !== "number") return undefined;
        total += m["track-count"];
    }
    return total;
}
