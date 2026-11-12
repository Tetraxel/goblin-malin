import { type DialogLink } from "#base/bridges/dialogBridge";
import { siteLabel, siteProviderKey, siteRank, toAppUri } from "#utils/appLinks";
import { normalizeUrl } from "./normalize";
import { type MbRelease } from "./types";

/** At most this many links are listed for a release. */
export const MAX_EXTERNAL_LINKS = 6;

/**
 * The pages other services have for a MusicBrainz release — its URL relationships (streaming, purchase, Discogs…) —
 * ready to show and open: listening / buying sites first, MusicBrainz' own pages left out, each address once. A link
 * a desktop app handles (Spotify, Deezer, Tidal) opens in that app (`openUrl`).
 */
export function externalLinks(release: Pick<MbRelease, "urls">): DialogLink[] {
    const seen = new Set<string>();
    const links: DialogLink[] = [];
    for (const url of release.urls ?? []) {
        let host = "";
        try {
            host = new URL(url).hostname;
        } catch {
            continue; // not an address
        }
        if (/(^|\.)musicbrainz\.org$/i.test(host)) continue;
        const key = normalizeUrl(url);
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ label: siteLabel(url), url, openUrl: toAppUri(url), providerKey: siteProviderKey(url) });
    }
    // Stable: sites of the same rank keep MusicBrainz' order.
    return links
        .map((link, i) => ({ link, i }))
        .sort((a, b) => siteRank(a.link.url) - siteRank(b.link.url) || a.i - b.i)
        .map(({ link }) => link)
        .slice(0, MAX_EXTERNAL_LINKS);
}
