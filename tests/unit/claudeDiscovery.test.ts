import { describe, test, expect, beforeAll } from "vitest";
import { platformRegistry } from "#base/platformRegistry";
import { urlParserRegistry } from "#base/urlParser";
import {
    claudeLinksToTracks,
    MIN_LINK_CONFIDENCE,
} from "#flows/musicDownloadFlow/services/metadata-providers/claude/convertClaudeToTrack";
import {
    buildClaudeDiscoveryPrompt,
    buildClaudeDiscoverySchema,
} from "#flows/musicDownloadFlow/services/metadata-providers/claude/claudePrompt";
import {
    buildClaudeArgs,
    parseClaudeOutput,
    classifyFailure,
    ClaudeCliError,
} from "#flows/musicDownloadFlow/services/apis/claude-client";

// The real parsers live on the (heavy) metadata services; these stand-ins have the same contract.
// ...and the platform capabilities the real services declare (`platformAliases` / `trackUrl`).
beforeAll(() => {
    platformRegistry.registerAliases("youtube", ["youtubeMusic"]);
    platformRegistry.registerTrackUrl("youtube", (id) => `https://www.youtube.com/watch?v=${id}`);
    platformRegistry.registerTrackUrl("spotify", (id) => `https://open.spotify.com/track/${id}`);
    urlParserRegistry.register((url) => {
        const m = /^https:\/\/open\.spotify\.com\/track\/(\w+)/.exec(url);
        return m ? { platform: "spotify", type: "track", id: m[1] } : null;
    });
    urlParserRegistry.register((url) => {
        const u = new URL(url);
        if (!/youtube\.com$/.test(u.hostname)) return null;
        return { platform: "youtube", type: "track", id: u.searchParams.get("v") ?? undefined };
    });
});

describe("claudeLinksToTracks", () => {
    test("turns recognised links into rudimentary tracks attributed to claude", () => {
        const [track] = claudeLinksToTracks(
            [{ platform: "spotify", url: "https://open.spotify.com/track/abc123?si=xyz", confidence: 0.9 }],
            ["spotify"]
        );
        expect(track).toMatchObject({
            id: "abc123",
            platform: "spotify",
            url: "https://open.spotify.com/track/abc123",
            uri: "SPOTIFY::TRACK::abc123",
            fetchedBy: "claude",
        });
    });

    test("canonicalises YouTube URLs and shares the youtube uri", () => {
        const [track] = claudeLinksToTracks(
            [{ platform: "youtube", url: "https://music.youtube.com/watch?v=vid1&list=x", confidence: 0.8 }],
            ["youtube"]
        );
        expect(track.url).toBe("https://www.youtube.com/watch?v=vid1");
        expect(track.uri).toBe("YOUTUBE::TRACK::vid1");
    });

    test("drops low-confidence, unparseable, non-wanted and duplicate links", () => {
        const tracks = claudeLinksToTracks(
            [
                {
                    platform: "spotify",
                    url: "https://open.spotify.com/track/low",
                    confidence: MIN_LINK_CONFIDENCE - 0.1,
                },
                { platform: "spotify", url: "https://example.com/not-a-track", confidence: 0.9 },
                { platform: "spotify", url: "https://open.spotify.com/track/notWanted", confidence: 0.9 },
                { platform: "youtube", url: "https://www.youtube.com/watch?v=dup", confidence: 0.9 },
                { platform: "youtube", url: "https://music.youtube.com/watch?v=dup", confidence: 0.9 },
            ],
            ["youtube"]
        );
        expect(tracks.map((t) => t.uri)).toEqual(["YOUTUBE::TRACK::dup"]);
    });

    test("ignores malformed entries instead of throwing", () => {
        const tracks = claudeLinksToTracks(
            [null, {}, { url: 42, confidence: 1 }] as unknown as Parameters<typeof claudeLinksToTracks>[0],
            ["spotify"]
        );
        expect(tracks).toEqual([]);
    });
});

describe("parseClaudeOutput", () => {
    const ok = { is_error: false, subtype: "success", duration_ms: 1200, num_turns: 3, total_cost_usd: 0.02 };

    test("reads structured_output and run stats", () => {
        const result = parseClaudeOutput<{ links: unknown[] }>(
            JSON.stringify({ ...ok, structured_output: { links: [] } })
        );
        expect(result).toEqual({ data: { links: [] }, durationMs: 1200, turns: 3, costUsd: 0.02 });
    });

    test("falls back to a JSON result string, even inside a code fence", () => {
        const result = parseClaudeOutput<{ a: number }>(JSON.stringify({ ...ok, result: '```json\n{"a":1}\n```' }));
        expect(result.data).toEqual({ a: 1 });
    });

    test.each([
        ["Not logged in · Please run /login", "not-logged-in"],
        ["Claude AI usage limit reached|1760000000", "quota"],
        ["something else broke", "failed"],
    ])("classifies the error %j as %s", (text, code) => {
        const run = () => parseClaudeOutput(JSON.stringify({ is_error: true, result: text }));
        expect(run).toThrow(ClaudeCliError);
        try {
            run();
        } catch (e) {
            expect((e as ClaudeCliError).code).toBe(code);
        }
    });

    test.each([
        ["The site I visited says: rate limit reached, try again in 10 minutes", "failed"],
        ["I could not check the quota page; it was behind a login", "failed"],
        ["The page returned unauthorized, so I could not read it", "failed"],
        ["Spotify's API resets in 30 seconds", "failed"],
        ["5-hour limit reached ∙ resets 3pm", "quota"],
        ["API Error: 429 rate_limit_error", "quota"],
        ["Claude usage limit reached. Your limit will reset at 3pm", "quota"],
        ["Session limit reached ∙ resets 3pm", "quota"],
        ["Weekly limit reached", "quota"],
        ["You've reached your usage limit", "quota"],
    ])("a failure that is the model's own words is not taken for the plan's limit: %j", (text, code) => {
        try {
            parseClaudeOutput(JSON.stringify({ is_error: true, result: text }));
        } catch (e) {
            expect((e as ClaudeCliError).code).toBe(code);
        }
    });

    test("the HTTP status of the error, when the CLI gives it, decides", () => {
        const code = (status: number, text: string) => {
            try {
                parseClaudeOutput(JSON.stringify({ is_error: true, api_error_status: status, result: text }));
            } catch (e) {
                return (e as ClaudeCliError).code;
            }
        };
        expect(code(429, "anything")).toBe("quota");
        expect(code(401, "anything")).toBe("not-logged-in");
        expect(code(500, "rate limit quota unauthorized")).toBe("failed");
    });

    test("stderr is the process speaking: it is read whole", () => {
        expect(classifyFailure("error: monthly quota exceeded")).toBe("quota");
        expect(classifyFailure("401 Unauthorized")).toBe("not-logged-in");
        expect(classifyFailure("segfault")).toBe("failed");
    });

    test("rejects non-JSON and answers without data", () => {
        expect(() => parseClaudeOutput("oops")).toThrow(/non-JSON/);
        expect(() => parseClaudeOutput(JSON.stringify({ ...ok, result: "just prose" }))).toThrow(
            /no structured answer/
        );
    });
});

describe("buildClaudeArgs", () => {
    const base = { prompt: "p", systemPrompt: "sys", model: "sonnet", jsonSchema: { type: "object" } };

    test("is headless, minimal-context and pre-approves only the given tools", () => {
        const args = buildClaudeArgs({ ...base, tools: ["WebSearch", "WebFetch"] });
        expect(args).toContain("-p");
        expect(args).toEqual(expect.arrayContaining(["--no-session-persistence", "--disable-slash-commands"]));
        expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
        expect(args[args.indexOf("--system-prompt") + 1]).toBe("sys");
        expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
        const allowed = args.indexOf("--allowedTools");
        expect(args.slice(allowed + 1, allowed + 3)).toEqual(["WebSearch", "WebFetch"]);
        expect(args[args.indexOf("--json-schema") + 1]).toBe('{"type":"object"}');
        // The prompt travels over stdin, never as an argument.
        expect(args).not.toContain("p");
    });

    test("with no tools it disables them all and approves nothing", () => {
        const args = buildClaudeArgs(base);
        expect(args[args.indexOf("--tools") + 1]).toBe("");
        expect(args).not.toContain("--allowedTools");
    });
});

describe("discovery prompt", () => {
    const query = {
        trackName: "Get Lucky",
        artists: ["Daft Punk", "Pharrell Williams"],
        album: "Random Access Memories",
        isrc: "USQX91300108",
        durationMs: 369000,
        sourcePlatform: "spotify",
        sourceUrl: "https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq",
        wanted: ["youtube" as const],
        model: "sonnet",
    };

    test("states the facts the model needs to identify the recording", () => {
        const prompt = buildClaudeDiscoveryPrompt(query);
        expect(prompt).toContain('Track: "Get Lucky"');
        expect(prompt).toContain("Artists: Daft Punk, Pharrell Williams");
        expect(prompt).toContain("ISRC: USQX91300108");
        expect(prompt).toContain("Duration: 6:09");
        expect(prompt).toContain("- youtube: https://www.youtube.com/watch?v=<id>");
    });

    test("tells the model a re-upload may be linked to its official release — never the reverse, official first", () => {
        const prompt = buildClaudeDiscoveryPrompt(query);
        expect(prompt).toContain("unofficial re-upload");
        expect(prompt).toContain("the official Spotify track, then the official YouTube upload");
        expect(prompt).toContain("Never the other way round");
        // The rule that keeps real covers/remixes out is still there.
        expect(prompt).toContain("Not a cover, remix, live version, karaoke");
    });

    test("the schema only allows the wanted platforms", () => {
        const schema = buildClaudeDiscoverySchema(["youtube", "soundcloud"]) as {
            properties: { links: { items: { properties: { platform: { enum: string[] } } } } };
        };
        expect(schema.properties.links.items.properties.platform.enum).toEqual(["youtube", "soundcloud"]);
    });
});
