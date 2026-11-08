import { urlParserRegistry, ParsedUrl } from "#base/urlParser";

export type SupportedPlatform = string;
export type DetectedUrl = ParsedUrl & { raw: string };

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;
// A link pasted without its scheme (`open.spotify.com/track/…`, `youtu.be/…`): a domain followed by a path.
const SCHEMELESS_REGEX = /(?<![\w@/.:-])(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s"'<>]+/gi;

export function detectUrls(text: string): DetectedUrl[] {
    const withScheme = text.match(URL_REGEX) ?? [];
    const schemeless = (text.replace(URL_REGEX, " ").match(SCHEMELESS_REGEX) ?? []).map((link) => `https://${link}`);
    // Links in another notation (`spotify:track:<id>`) are read by the services that know them.
    const matches = [...withScheme, ...schemeless, ...urlParserRegistry.normalize(text)];
    const results: DetectedUrl[] = [];
    for (const raw of matches) {
        // Recognition is purely service-based. Unrecognized URLs are kept (shown as
        // "Unknown") so they still become tasks.
        const parsed = urlParserRegistry.parse(raw);
        results.push(parsed ? { ...parsed, raw } : { platform: "unknown", type: "unknown", raw });
    }
    return results;
}
