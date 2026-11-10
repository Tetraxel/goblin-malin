import type { Market } from "@spotify/web-api-ts-sdk";

// Two uppercase letters; Spotify rejects anything that is not one of its markets, which surfaces
// as a failed search, so only the shape is checked here.
const MARKET_SHAPE = /^[A-Z]{2}$/;

function localeRegion(locale: string | undefined): string | undefined {
    if (!locale) return undefined;
    try {
        return new Intl.Locale(locale).maximize().region;
    } catch {
        return undefined;
    }
}

/**
 * The market (ISO 3166-1 alpha-2 country) to search Spotify in. Spotify uses it to decide which
 * tracks are available and to relink a track to its playable version in that country.
 *
 * Order: the user's `market` setting, else the country of the OS locale, else `undefined` (no
 * market sent, so Spotify does not filter by availability).
 */
export function resolveSpotifyMarket(setting: unknown, systemLocale?: string): Market | undefined {
    const configured = typeof setting === "string" ? setting.trim().toUpperCase() : "";
    if (MARKET_SHAPE.test(configured)) return configured as Market;

    const region = localeRegion(systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale)?.toUpperCase();
    return region && MARKET_SHAPE.test(region) ? (region as Market) : undefined;
}
