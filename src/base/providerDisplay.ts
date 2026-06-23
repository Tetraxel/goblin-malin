export interface ProviderDisplay {
    label: string; // "Spotify"   — full display name
    acronym: string; // "SPOTIFY"   — short badge / column header
    color: string; // "#1ed760"   — primary color
    colorSubtle: string; // "#156b30"   — dark variant for attribution badges (FieldRow)
    colorBright: string; // "#1db954"   — bright variant for panel headers (MetadataDetailPanel)
}

const BUILTIN_PROVIDERS: Record<string, ProviderDisplay> = {
    spotify: { label: "Spotify", acronym: "SPOTIFY", color: "#1ed760", colorSubtle: "#156b30", colorBright: "#1db954" },
    youtube: { label: "YouTube", acronym: "YT", color: "#ff0033", colorSubtle: "#7a1500", colorBright: "#ff4040" },
    youtubeMusic: {
        label: "YT Music",
        acronym: "YT MUSIC",
        color: "#ff0033",
        colorSubtle: "#7a1500",
        colorBright: "#ff4040",
    },
    musicBrainz: {
        label: "MusicBrainz",
        acronym: "MB",
        color: "#741b81",
        colorSubtle: "#6b1060",
        colorBright: "#ba47b5",
    },
    deezer: { label: "Deezer", acronym: "DEEZER", color: "#9546f7", colorSubtle: "#005570", colorBright: "#00c7f2" },
    appleMusic: {
        label: "Apple Music",
        acronym: "APPLE",
        color: "#fb233b",
        colorSubtle: "#505050",
        colorBright: "#cccccc",
    },
    itunes: { label: "iTunes", acronym: "ITUNES", color: "#fb233b", colorSubtle: "#505050", colorBright: "#cccccc" },
    tidal: { label: "Tidal", acronym: "TIDAL", color: "#ffffff", colorSubtle: "#0030a0", colorBright: "#4080ff" },
    soundcloud: {
        label: "SoundCloud",
        acronym: "SOUNDCLOUD",
        color: "#ff5510",
        colorSubtle: "#7a2500",
        colorBright: "#ff5500",
    },
    bandcamp: {
        label: "Bandcamp",
        acronym: "BANDCAMP",
        color: "#3b8db2",
        colorSubtle: "#0a5060",
        colorBright: "#1da0c3",
    },
    ytdlp: { label: "YtDlp", acronym: "YTDLP", color: "#ff0033", colorSubtle: "#7a1500", colorBright: "#ff4040" },
    soulseek: {
        label: "Soulseek",
        acronym: "SOULSEEK",
        color: "#2700ff",
        colorSubtle: "#100080",
        colorBright: "#4040ff",
    },
    songlink: {
        label: "Songlink",
        acronym: "SL",
        color: "#f76c1b",
        colorSubtle: "#7a3000",
        colorBright: "#ff8c3a",
    },
    spotifyUrlInfo: {
        label: "Scraped",
        acronym: "SCRAPED SPOTIFY",
        color: "#3bb0a0",
        colorSubtle: "#0f5a52",
        colorBright: "#56d4c4",
    },
};

const FALLBACK: ProviderDisplay = {
    label: "",
    acronym: "",
    color: "white",
    colorSubtle: "#404040",
    colorBright: "#aaaaaa",
};

class ProviderDisplayRegistry {
    private map = new Map<string, ProviderDisplay>(Object.entries(BUILTIN_PROVIDERS));

    register(key: string, display: ProviderDisplay): void {
        this.map.set(key, display);
    }

    get(key: string): ProviderDisplay {
        return this.map.get(key) ?? { ...FALLBACK, label: key, acronym: key.toUpperCase() };
    }
}

export const providerDisplayRegistry = new ProviderDisplayRegistry();
