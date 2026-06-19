import { urlParserRegistry, ParsedUrl } from "#base/urlParser";

export type SupportedPlatform = string;
export type DetectedUrl = ParsedUrl & { raw: string };

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;

export function detectUrls(text: string): DetectedUrl[] {
    const matches = text.match(URL_REGEX) ?? [];
    const results: DetectedUrl[] = [];
    for (const raw of matches) {
        // Recognition is purely service-based. Unrecognized URLs are kept (shown as
        // "Unknown") so they still become tasks.
        const parsed = urlParserRegistry.parse(raw);
        results.push(parsed ? { ...parsed, raw } : { platform: "unknown", type: "unknown", raw });
    }
    return results;
}
