// Must stay the first import: it points the app's data folder at a temp dir before any app code loads.
import { loadWorld, makeTask, removeDataDir, resetWorld, endWorld, PRIMARY } from "./helpers/musicBrainzWorld";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { platformRegistry } from "#base/platformRegistry";
import { urlParserRegistry } from "#base/urlParser";
import {
    claudeLinksToResults,
    claudeLinksToTracks,
} from "#flows/musicDownloadFlow/services/metadata-providers/claude/convertClaudeToTrack";
import {
    buildClaudeDiscoveryPrompt,
    buildClaudeDiscoverySchema,
} from "#flows/musicDownloadFlow/services/metadata-providers/claude/claudePrompt";

/**
 * "Why did Claude choose this?": an explanation for each link, the whole text in the log, a few lines in the
 * Metadata Sources panel when the search details are on. A setting turns it off (it costs a little more output).
 */

// The service pulls in its UI cell, whose "#components/…" alias vitest cannot resolve: the cell is not under test.
vi.mock("#components/AnimatedIcon", () => ({ AnimatedIcon: () => null, Icon: () => null }));

beforeAll(() => {
    platformRegistry.registerAliases("youtube", ["youtubeMusic"]);
    platformRegistry.registerTrackUrl("youtube", (id) => `https://www.youtube.com/watch?v=${id}`);
    platformRegistry.registerTrackUrl("spotify", (id) => `https://open.spotify.com/track/${id}`);
    urlParserRegistry.register((url) => {
        const m = /^https:\/\/open\.spotify\.com\/track\/(\w+)/.exec(url);
        return m ? { platform: "spotify", type: "track", id: m[1] } : null;
    });
});

const query = {
    trackName: "Dans ma ville, on traîne",
    artists: ["Orelsan"],
    sourcePlatform: "youtube",
    wanted: ["spotify" as const],
    model: "sonnet",
};

describe("the prompt and the schema", () => {
    test("without explanations nothing extra is asked for (and the schema is the old one)", () => {
        const prompt = buildClaudeDiscoveryPrompt(query);
        expect(prompt).not.toContain("explanation");
        expect(prompt).not.toContain("reasoning");
        const schema = buildClaudeDiscoverySchema(["spotify"]) as {
            properties: { reasoning?: unknown; links: { items: { properties: Record<string, unknown> } } };
        };
        expect(schema.properties.reasoning).toBeUndefined();
        expect(schema.properties.links.items.properties.explanation).toBeUndefined();
    });

    test("with explanations it asks for one per link, and for the reasoning as a whole", () => {
        const prompt = buildClaudeDiscoveryPrompt({ ...query, explain: true });
        // Two texts with two jobs: one short line for the narrow panel, a few sentences for the log...
        expect(prompt).toContain("summary, for every link: ONE line of at most 90 characters");
        expect(prompt).toContain("explanation, for every link: 2 to 4 sentences for the log");
        // ...and the lookup-level text is only about what was left out (it used to repeat the explanations).
        expect(prompt).toContain("reasoning: ONLY when you left a wanted platform out");
        const schema = buildClaudeDiscoverySchema(["spotify"], true) as {
            properties: {
                reasoning: unknown;
                links: { items: { properties: Record<string, unknown>; required: string[] } };
            };
        };
        expect(schema.properties.reasoning).toEqual({ type: "string" });
        expect(schema.properties.links.items.properties.explanation).toEqual({ type: "string" });
        expect(schema.properties.links.items.properties.summary).toEqual({ type: "string" });
        // Optional: an answer without them is still a valid answer.
        expect(schema.properties.links.items.required).not.toContain("explanation");
    });
});

describe("claudeLinksToResults", () => {
    test("keeps the explanation of every kept link, by the track's uri", () => {
        const { tracks, explanations } = claudeLinksToResults(
            [
                {
                    platform: "spotify",
                    url: "https://open.spotify.com/track/abc123",
                    confidence: 0.9,
                    explanation: "  Official track by Orelsan. Same duration.  ",
                },
                { platform: "spotify", url: "https://open.spotify.com/track/nothing", confidence: 0.9 },
            ],
            ["spotify"]
        );
        expect(tracks).toHaveLength(2);
        expect(explanations).toEqual({ "SPOTIFY::TRACK::abc123": "Official track by Orelsan. Same duration." });
    });

    test("an explanation of a link that was dropped is dropped with it", () => {
        const { explanations } = claudeLinksToResults(
            [{ platform: "spotify", url: "https://example.com/x", confidence: 0.9, explanation: "ghost" }],
            ["spotify"]
        );
        expect(explanations).toEqual({});
    });

    test("claudeLinksToTracks still returns just the tracks", () => {
        expect(
            claudeLinksToTracks(
                [{ platform: "spotify", url: "https://open.spotify.com/track/abc", confidence: 0.9 }],
                ["spotify"]
            )
        ).toHaveLength(1);
    });
});

describe("the Claude service", () => {
    let w: Awaited<ReturnType<typeof loadWorld>>;
    let Service: typeof import("#flows/musicDownloadFlow/services/metadata-providers/claude/ClaudeDiscoveryService").ClaudeDiscoveryService;
    let Client: typeof import("#flows/musicDownloadFlow/services/apis/claude-client").ClaudeClient;
    let runWithoutCache: typeof import("#utils/cache").runWithoutCache;
    let runSpy: ReturnType<typeof vi.spyOn>;
    let logged: string[];

    const URL = "https://open.spotify.com/track/abc123";
    const answer = {
        reasoning: "Apple Music left out: no page for this recording was found.",
        links: [
            {
                platform: "spotify",
                url: URL,
                confidence: 0.9,
                evidence: "Official, same duration",
                explanation: "It is the official release by Orelsan.\nSame title; duration 4:00 against 4:02.",
                summary: "Official Spotify release; duration unconfirmed (~4:00)",
            },
        ],
    };

    beforeAll(async () => {
        w = await loadWorld();
        ({ ClaudeDiscoveryService: Service } =
            await import("#flows/musicDownloadFlow/services/metadata-providers/claude/ClaudeDiscoveryService"));
        ({ ClaudeClient: Client } = await import("#flows/musicDownloadFlow/services/apis/claude-client"));
        ({ runWithoutCache } = await import("#utils/cache"));
    });
    afterAll(() => removeDataDir());
    beforeEach(async () => {
        await resetWorld();
        logged = [];
        runSpy = vi.spyOn(Client.prototype, "run").mockResolvedValue({ data: answer } as never);
    });
    afterEach(async () => {
        runSpy.mockRestore();
        await endWorld();
    });

    const discover = async () => {
        const task = await makeTask();
        const logger = {
            info: (m: string) => void logged.push(m),
            warn: () => {},
            error: () => {},
            debug: () => {},
            createChild: () => logger,
        };
        const service = new Service(task, logger as never);
        return runWithoutCache(() => service.discoverFromUri(PRIMARY, { wantedPlatforms: ["spotify"] }));
    };
    const setExplain = (explain: boolean) =>
        w.SettingsStore.getInstance().patchMusicSettings({
            metadata: { discoveryProviders: { claude: { explain } } },
        });

    // (The shared test world registers a fake Spotify parser that reads every track link as id "t1".)
    test("on by default: the explanation travels with the result, and the whole text is in the log", async () => {
        const result = await discover();

        expect(result.explanations).toEqual({
            // Stored tidied (one line), in full: the log has the text as Claude wrote it.
            "SPOTIFY::TRACK::t1": "It is the official release by Orelsan. Same title; duration 4:00 against 4:02.",
        });
        expect(result.summaries).toEqual({
            "SPOTIFY::TRACK::t1": "Official Spotify release; duration unconfirmed (~4:00)",
        });
        const args = runSpy.mock.calls[0][0] as { prompt: string; jsonSchema: { properties: Record<string, unknown> } };
        expect(args.prompt).toContain("explanation, for every link");
        expect(args.jsonSchema.properties.reasoning).toBeDefined();

        const log = logged.join("\n---\n");
        expect(log).toContain("Claude left platforms out");
        expect(log).toContain("Apple Music left out: no page for this recording was found.");
        expect(log).toContain("Why Claude chose spotify https://open.spotify.com/track/abc123");
        expect(log).toContain("Same title; duration 4:00 against 4:02."); // the full text, not a summary
    });

    test("switched off: nothing is asked for, nothing is kept, nothing extra is logged", async () => {
        await setExplain(false);
        runSpy.mockResolvedValue({ data: { links: [{ platform: "spotify", url: URL, confidence: 0.9 }] } } as never);

        const result = await discover();

        expect(result.explanations).toBeUndefined();
        expect(result.summaries).toBeUndefined();
        const args = runSpy.mock.calls[0][0] as { prompt: string; jsonSchema: { properties: Record<string, unknown> } };
        expect(args.prompt).not.toContain("explanation");
        expect(args.jsonSchema.properties.reasoning).toBeUndefined();
        expect(logged.join("\n")).not.toContain("Why Claude chose");
        expect(result.tracks).toHaveLength(1);
    });

    test("the setting is part of what is asked: turning it on again does not reuse an answer without explanations", async () => {
        await setExplain(false);
        await discover();
        await setExplain(true);
        await discover();
        const prompts = runSpy.mock.calls.map((c: unknown[]) => (c[0] as { prompt: string }).prompt);
        expect(prompts[0]).not.toContain("explanation");
        expect(prompts[1]).toContain("explanation");
    });

    test("an answer from before explanations existed (a bare list of links) still works", async () => {
        runSpy.mockResolvedValue({ data: { links: answer.links.map(({ explanation: _e, ...l }) => l) } } as never);
        const result = await discover();
        expect(result.tracks).toHaveLength(1);
        expect(result.explanations).toBeUndefined();
    });
});

describe("what is kept of what Claude wrote", () => {
    const link = (extra: object) => ({
        platform: "spotify",
        url: "https://open.spotify.com/track/abc123",
        confidence: 0.9,
        ...extra,
    });

    test("a summary that is too long is cut at a word, with an ellipsis", () => {
        const { summaries } = claudeLinksToResults([link({ summary: "very long ".repeat(40) })], ["spotify"]);
        const summary = Object.values(summaries)[0];
        expect(summary.length).toBeLessThanOrEqual(140);
        expect(summary.endsWith("…")).toBe(true);
    });

    test("an explanation is capped too, before it is stored in the session", () => {
        const { explanations } = claudeLinksToResults([link({ explanation: "word ".repeat(1000) })], ["spotify"]);
        expect(Object.values(explanations)[0].length).toBeLessThanOrEqual(1000);
    });

    test("no summary from Claude: the first sentence of the explanation stands in", () => {
        const { summaries } = claudeLinksToResults(
            [
                link({
                    explanation: "Official release by Orelsan. Duration could not be confirmed. Another entry exists.",
                }),
            ],
            ["spotify"]
        );
        expect(Object.values(summaries)).toEqual(["Official release by Orelsan."]);
    });

    test("neither: nothing is kept, and blank text counts as nothing", () => {
        const { summaries, explanations } = claudeLinksToResults(
            [link({ summary: "  ", explanation: "" })],
            ["spotify"]
        );
        expect(summaries).toEqual({});
        expect(explanations).toEqual({});
    });
});
