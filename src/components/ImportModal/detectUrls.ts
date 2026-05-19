import { urlParserRegistry, ParsedUrl } from "#base/urlParser";

export type SupportedPlatform = string;
export type DetectedUrl = ParsedUrl & { raw: string };

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;

export function detectUrls(text: string): DetectedUrl[] {
    const matches = text.match(URL_REGEX) ?? [];
    const results: DetectedUrl[] = [];
    for (const raw of matches) {
        const parsed = urlParserRegistry.parse(raw);
        if (parsed) results.push({ ...parsed, raw });
    }
    return results;
}
