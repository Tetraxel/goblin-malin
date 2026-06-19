export type ParsedUrl = {
    platform: string;
    type: "track" | "album" | "playlist" | "unknown";
    id?: string;
};

export type UrlParser = (url: string) => ParsedUrl | null;

class UrlParserRegistry {
    // Only registered MetadataService.parseUrl functions live here — there are no
    // builtin parsers, so recognition is purely service-based.
    private parsers: UrlParser[] = [];

    register(parser: UrlParser): void {
        this.parsers.unshift(parser);
    }

    parse(url: string): ParsedUrl | null {
        for (const parser of this.parsers) {
            const result = parser(url);
            if (result) return result;
        }
        return null;
    }
}

export const urlParserRegistry = new UrlParserRegistry();
