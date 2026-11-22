export type ParsedUrl = {
    platform: string;
    type: "track" | "album" | "playlist" | "unknown";
    id?: string;
};

export type UrlParser = (url: string) => ParsedUrl | null;

/** Finds links written another way than a plain URL (a `scheme:id` URI…) in a text and returns them as URLs. */
export type LinkNormalizer = (text: string) => string[];

/**
 * A short link only says what it leads to (a track, an album) once followed: the resolver returns the address it leads
 * to, or `null` at once (no network) for a link that is not one of its short links.
 */
export type LinkResolver = (url: string) => Promise<string> | null;

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
    /** Tracks the list holds but the platform will not play here (blocked in the user's country): left out, counted. */
    unavailable?: number;
};

class UrlParserRegistry {
    // Only registered MetadataService.parseUrl functions live here — there are no
    // builtin parsers, so recognition is purely service-based.
    private parsers: UrlParser[] = [];
    private normalizers: LinkNormalizer[] = [];
    private resolvers: LinkResolver[] = [];
    /** A short link leads to the same place for the whole run: it is followed once. */
    private resolved = new Map<string, Promise<string>>();

    register(parser: UrlParser): void {
        this.parsers.unshift(parser);
    }

    registerNormalizer(normalizer: LinkNormalizer): void {
        this.normalizers.push(normalizer);
    }

    registerResolver(resolver: LinkResolver): void {
        this.resolvers.push(resolver);
    }

    /**
     * The address a short link leads to (`link.deezer.com/s/…` → `deezer.com/album/…`), so the import can tell a track
     * from an album or a playlist; any other link as it is. Never throws: a link that cannot be followed now stays as
     * it was (the track reading it reports the problem).
     */
    resolve(url: string): Promise<string> {
        const known = this.resolved.get(url);
        if (known) return known;
        for (const resolver of this.resolvers) {
            let pending: Promise<string> | null;
            try {
                pending = resolver(url);
            } catch {
                continue; // a resolver that throws does not read this link: the next one may
            }
            if (!pending) continue;
            const settled = pending.then(
                (target) => target || url,
                () => url
            );
            this.resolved.set(url, settled);
            // A failure is not remembered: the link is followed again next time.
            void settled.then((target) => {
                if (target === url) this.resolved.delete(url);
            });
            return settled;
        }
        return Promise.resolve(url);
    }

    /** `resolve` for every link, in the same order. */
    resolveAll(urls: readonly string[]): Promise<string[]> {
        return Promise.all(urls.map((url) => this.resolve(url)));
    }

    /** Every URL the registered services can read out of `text` in a notation other than a plain URL. */
    normalize(text: string): string[] {
        return this.normalizers.flatMap((normalizer) => normalizer(text));
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
