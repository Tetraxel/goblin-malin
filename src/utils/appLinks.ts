/**
 * What a link is, and how to open it. A link one of the registered metadata services reads (Spotify, YouTube…) is that
 * service's: its name and colors come from the service's display, and the address that opens it in its desktop app from
 * the service's `openUri`. The tables below are only the fallback for sites no service reads (Deezer, Bandcamp,
 * Discogs…), and for a service that is not registered.
 *
 * Handing an app's own address to the OS (`spotify:album:<id>`) opens the installed app on that page, instead of a
 * browser tab that then asks the app to take over. Any link without a known app address stays a web link.
 */
import { platformRegistry } from "#base/platformRegistry";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { urlParserRegistry, type ParsedUrl } from "#base/urlParser";

/** The registered service that reads `url`: its key (the provider display's) and what it read. */
function recognizedBy(url: string): { key: string; parsed: ParsedUrl } | null {
    try {
        const parsed = urlParserRegistry.parse(url);
        return parsed ? { key: platformRegistry.canonical(parsed.platform), parsed } : null;
    } catch {
        return null; // a service's parser must never break a link
    }
}

const KINDS = "track|album|artist|playlist";
const SPOTIFY = new RegExp(`^https?://open\\.spotify\\.com/(?:intl-[a-z]{2}(?:-[a-z]{2})?/)?(${KINDS})/([A-Za-z0-9]+)`);
const DEEZER = new RegExp(`^https?://(?:www\\.)?deezer\\.com/(?:[a-z]{2}/)?(${KINDS})/(\\d+)`);
const TIDAL = new RegExp(`^https?://(?:www\\.|listen\\.)?tidal\\.com/(?:browse/)?(${KINDS})/(\\d+)`);

/** The address that opens `url` in its desktop app, or `url` itself when no app address is known for it. */
export function toAppUri(url: string): string {
    const known = recognizedBy(url);
    const own = known ? platformRegistry.openUri(known.parsed) : undefined;
    if (own) return own;
    const spotify = SPOTIFY.exec(url);
    if (spotify) return `spotify:${spotify[1]}:${spotify[2]}`;
    const deezer = DEEZER.exec(url);
    if (deezer) return `deezer://www.deezer.com/${deezer[1]}/${deezer[2]}`;
    const tidal = TIDAL.exec(url);
    if (tidal) return `tidal://${tidal[1]}/${tidal[2]}`;
    return url;
}

/** True when `toAppUri` knows a desktop app for this link. */
export function opensInApp(url: string): boolean {
    return toAppUri(url) !== url;
}

/** Hostname pattern, the site's name, and — when the app knows the service — its key in the provider display registry. */
const SITES: [RegExp, string, string?][] = [
    [/(^|\.)spotify\.com$/, "Spotify", "spotify"],
    [/^music\.apple\.com$/, "Apple Music", "appleMusic"],
    [/(^|\.)(itunes|apple)\.com$/, "iTunes", "itunes"],
    [/(^|\.)deezer\.com$/, "Deezer", "deezer"],
    [/(^|\.)tidal\.com$/, "Tidal", "tidal"],
    [/(^|\.)bandcamp\.com$/, "Bandcamp", "bandcamp"],
    [/(^|\.)soundcloud\.com$/, "SoundCloud", "soundcloud"],
    [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube", "youtube"],
    [/(^|\.)musicbrainz\.org$/, "MusicBrainz", "musicBrainz"],
    [/(^|\.)qobuz\.com$/, "Qobuz"],
    [/(^|\.)beatport\.com$/, "Beatport"],
    [/(^|\.)amazon\.[a-z.]+$/, "Amazon"],
    [/(^|\.)discogs\.com$/, "Discogs"],
    [/(^|\.)allmusic\.com$/, "AllMusic"],
    [/(^|\.)last\.fm$/, "Last.fm"],
    [/(^|\.)genius\.com$/, "Genius"],
    [/(^|\.)wikidata\.org$/, "Wikidata"],
    [/(^|\.)wikipedia\.org$/, "Wikipedia"],
];

/** A short name for the site a link is on ("Spotify", "Bandcamp"…), else its host. */
export function siteLabel(url: string): string {
    const known = recognizedBy(url);
    if (known) return providerDisplayRegistry.get(known.key).label;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return SITES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, "");
    } catch {
        return url;
    }
}

/** The provider-registry key of the service a link is on (`providerDisplayRegistry`: its color), when it is a known one. */
export function siteProviderKey(url: string): string | undefined {
    const known = recognizedBy(url);
    if (known) return known.key;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return SITES.find(([pattern]) => pattern.test(host))?.[2];
    } catch {
        return undefined;
    }
}

/** Position of a link's site in the order links are listed: where the music can be listened to or bought first. */
export function siteRank(url: string): number {
    const key = siteProviderKey(url);
    const label = siteLabel(url);
    const i = SITES.findIndex(([, name, siteKey]) => (key && siteKey ? siteKey === key : name === label));
    if (i !== -1) return i;
    // A service the app reads is a place to listen, even when the table above has never heard of it.
    return recognizedBy(url) ? -1 : SITES.length;
}
