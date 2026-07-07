export type ParsedUrl = {
    platform: string;
    type: "track" | "album" | "playlist" | "unknown";
    id?: string;
};

export type UrlParser = (url: string) => ParsedUrl | null;

// Result of a service's optional expandCollection capability: a resolved,
// importable track listing for an album/playlist URL. trackUrls are canonical
// track URLs — importable as-is via the same recognition path as any pasted
// track URL. Lives alongside ParsedUrl since both describe "what a URL is" —
// generic across any provider, not music-specific.
export type CollectionExpansion = {
    kind: "album" | "playlist";
    name: string;
    ownerName?: string;
    trackUrls: string[];
    totalCount: number;
    truncated?: boolean;
};

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
