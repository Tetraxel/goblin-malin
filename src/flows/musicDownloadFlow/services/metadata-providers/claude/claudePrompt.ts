import type { Platform } from "#flows/musicDownloadFlow/types";

/** Everything Claude is told about the track. Plain data, so it doubles as the (stable) cache key. */
export type ClaudeTrackQuery = {
    trackName: string;
    artists: string[];
    album?: string;
    releaseDate?: string;
    isrc?: string;
    durationMs?: number;
    sourcePlatform: string;
    sourceUrl?: string;
    /** Platforms to find the track on. */
    wanted: Platform[];
    model: string;
    /** Ask for an explanation of every link (and of what was left out). Part of the cache key: it changes the answer. */
    explain?: boolean;
};

export const CLAUDE_DISCOVERY_SYSTEM_PROMPT =
    "You are a music link resolver inside a download tool. Use WebSearch and WebFetch to find real track pages. " +
    "Never guess or construct a URL from memory. Answer only with the requested JSON.";

// What a valid track URL looks like per platform, so the model returns something the app can parse.
const URL_SHAPES: Partial<Record<Platform, string>> = {
    spotify: "https://open.spotify.com/track/<id>",
    youtube: "https://www.youtube.com/watch?v=<id> (or the music.youtube.com equivalent)",
    youtubeMusic: "https://music.youtube.com/watch?v=<id>",
    soundcloud: "https://soundcloud.com/<artist>/<track>",
    deezer: "https://www.deezer.com/track/<id>",
    tidal: "https://tidal.com/browse/track/<id>",
    appleMusic: "https://music.apple.com/<country>/album/<name>/<id>?i=<trackId>",
    bandcamp: "https://<artist>.bandcamp.com/track/<name>",
};

function formatDuration(ms: number): string {
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function buildClaudeDiscoveryPrompt(q: ClaudeTrackQuery): string {
    const facts = [
        `Track: "${q.trackName}"`,
        `Artists: ${q.artists.join(", ") || "unknown"}`,
        q.album ? `Album: ${q.album}` : null,
        q.releaseDate ? `Release date: ${q.releaseDate}` : null,
        q.isrc ? `ISRC: ${q.isrc}` : null,
        q.durationMs ? `Duration: ${formatDuration(q.durationMs)}` : null,
        q.sourceUrl ? `Known on ${q.sourcePlatform}: ${q.sourceUrl}` : null,
    ].filter((line): line is string => line !== null);

    const wanted = q.wanted.map((p) => `- ${p}${URL_SHAPES[p] ? `: ${URL_SHAPES[p]}` : ""}`);

    return [
        "Find this exact recording on the wanted platforms and return its track URLs.",
        "",
        ...facts,
        "",
        "Wanted platforms:",
        ...wanted,
        "",
        "Rules:",
        "- Only return URLs you actually saw in search results or fetched pages.",
        "- It must be the same recording as the known one: same title, artists and duration (within a few seconds). Not a cover, remix, live version, karaoke or lyric re-upload unless the known track is one.",
        "- Prefer the official upload (for YouTube: the artist's official audio/video or the auto-generated 'Topic' channel).",
        "- The known track may itself be an unofficial re-upload: a YouTube channel that is not the artist, their label or an auto-generated 'Topic' channel, with a title like 'Artist - Title (non official clip)', 'lyrics' or 'audio'. Then the title and artists above can be wrong (the \"artist\" may just be the channel name): open the known page if you need to, work out the real artist and title, and look for the OFFICIAL release of that same recording.",
        "- Linking such a re-upload to its official release is allowed, as long as it is the same recording (same song and version, duration within a few seconds). If several are wanted, prefer in this order: the official Spotify track, then the official YouTube upload (the artist's channel or the 'Topic' channel).",
        "- Never the other way round: when the known track is official, never answer with a re-upload, a lyric/audio copy or another channel's upload of it.",
        "- Omit a platform you are not reasonably sure about. An empty list is a perfectly good answer.",
        "- confidence is 0 to 1. evidence is at most 15 words on why this is the same recording (page title, channel, duration).",
        ...(q.explain
            ? [
                  "- summary, for every link: ONE line of at most 90 characters, shown in a narrow panel. What the page is and the main reason it matches, or the main doubt. Example: 'Official Spotify release; duration unconfirmed (~4:00)'. No filler, no repeating the title.",
                  "- explanation, for every link: 2 to 4 sentences for the log: which page it is (title, channel or artist), why it is the same recording, and anything that made you hesitate.",
                  "- reasoning: ONLY when you left a wanted platform out: one sentence per platform on why. Otherwise leave it empty. Do not repeat the explanations.",
              ]
            : []),
    ].join("\n");
}

export function buildClaudeDiscoverySchema(wanted: Platform[], explain = false): object {
    return {
        type: "object",
        properties: {
            ...(explain ? { reasoning: { type: "string" } } : {}),
            links: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        platform: { type: "string", enum: wanted },
                        url: { type: "string" },
                        confidence: { type: "number" },
                        evidence: { type: "string" },
                        ...(explain ? { summary: { type: "string" }, explanation: { type: "string" } } : {}),
                    },
                    required: ["platform", "url", "confidence"],
                },
            },
        },
        required: ["links"],
    };
}
