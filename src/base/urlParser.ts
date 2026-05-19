export type ParsedUrl = {
    platform: string;
    type: "track" | "album" | "playlist" | "unknown";
    id?: string;
};

export type UrlParser = (url: string) => ParsedUrl | null;

function tryParseUrl(url: string): URL | null {
    try {
        return new URL(url);
    } catch {
        return null;
    }
}

const BUILTIN_URL_PARSERS: UrlParser[] = [
    // soundcloud
    (url) => {
        const p = tryParseUrl(url);
        if (!p) return null;
        const host = p.hostname.replace(/^www\./, "");
        if (host !== "soundcloud.com" && !host.endsWith(".soundcloud.com")) return null;
        if (p.pathname === "/" || p.pathname === "") return null;
        return { platform: "soundcloud", type: "track" };
    },
    // deezer
    (url) => {
        const p = tryParseUrl(url);
        if (!p) return null;
        const host = p.hostname.replace(/^www\./, "");
        if (host !== "deezer.com" && !host.endsWith(".deezer.com")) return null;
        if (/\/track\//.test(p.pathname)) return { platform: "deezer", type: "track" };
        return null;
    },
    // apple music
    (url) => {
        const p = tryParseUrl(url);
        if (!p) return null;
        if (p.hostname !== "music.apple.com") return null;
        return { platform: "appleMusic", type: "track" };
    },
    // tidal
    (url) => {
        const p = tryParseUrl(url);
        if (!p) return null;
        const host = p.hostname.replace(/^www\./, "");
        if (host !== "tidal.com" && !host.endsWith(".tidal.com")) return null;
        if (/\/track\//.test(p.pathname)) return { platform: "tidal", type: "track" };
        return null;
    },
];

class UrlParserRegistry {
    private parsers: UrlParser[] = [...BUILTIN_URL_PARSERS];

    // Service parsers are prepended so they take priority over builtins
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
