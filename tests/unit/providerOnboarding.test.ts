import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { dialogBridge, type MatrixAnswer, type MatrixDialog } from "#base/bridges/dialogBridge";
import { appReady } from "#base/appReady";
import { metadataServiceRegistry, downloadServiceRegistry } from "#flows/musicDownloadFlow/registries";
import { describeDownloadLinks, downloadLinkInfo } from "#flows/musicDownloadFlow/downloadLinks";
import type { TrackMetadata } from "#flows/musicDownloadFlow/types";

beforeAll(async () => {
    // The providers the app registers that these tests talk about, in the app's order.
    const { YoutubeService } =
        await import("#flows/musicDownloadFlow/services/metadata-providers/youtube/YoutubeService");
    const { SoundCloudService } =
        await import("#flows/musicDownloadFlow/services/metadata-providers/soundcloud/SoundCloudService");
    const { DeezerService } = await import("#flows/musicDownloadFlow/services/metadata-providers/deezer/DeezerService");
    const { MetadataService } = await import("#flows/musicDownloadFlow/metadataService");
    const { YtDlpService } = await import("#flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService");
    const { SoulseekService } =
        await import("#flows/musicDownloadFlow/services/download-providers/soulseek/SoulseekService");
    metadataServiceRegistry.register("youtube", YoutubeService);
    metadataServiceRegistry.register("soundcloud", SoundCloudService);
    metadataServiceRegistry.register("deezer", DeezerService);
    // No real metadata provider is consent-gated any more: a stand-in that sends data to a third party.
    class CloudService extends MetadataService {
        static readonly display = { label: "Cloud Music", acronym: "CM", color: "#25d1da" };
        static readonly defaultSettings = {
            enabled: { label: "Enable", defaultValue: false, kind: "checkbox" },
        } as const;
        static readonly consent = { title: "Read Cloud Music links?", message: "Each link is sent to a third party." };
        static parseUrl() {
            return null;
        }
        getTrackMetadata(): Promise<TrackMetadata> {
            throw new Error("not used");
        }
        searchTrack(): Promise<never[]> {
            return Promise.resolve([]);
        }
    }
    metadataServiceRegistry.register("cloudMusic", CloudService as never);
    downloadServiceRegistry.register("ytdlp", YtDlpService);
    downloadServiceRegistry.register("soulseek", SoulseekService);
});

const track = (platform: string, apiProvider = platform) =>
    ({
        id: "1",
        trackName: "t",
        artists: [],
        url: "u",
        platform,
        apiProvider,
        type: "track",
    }) as unknown as TrackMetadata;

function makeDownloader(key: string) {
    const status = { set: vi.fn(), clear: vi.fn(), update: vi.fn() };
    const logger: Record<string, unknown> = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logger.createChild = () => logger;
    return downloadServiceRegistry.getFactories().get(key)!(
        { getStatus: () => status, id: "t" } as never,
        logger as never
    );
}

describe("which links a download provider uses", () => {
    test("yt-dlp downloads YouTube (and YouTube Music) and SoundCloud links, not the DRM platforms'", () => {
        const ytdlp = makeDownloader("ytdlp");
        expect(ytdlp.canDownload(track("youtube"))).toBe(true);
        expect(ytdlp.canDownload(track("youtubeMusic", "youtube"))).toBe(true);
        expect(ytdlp.canDownload(track("soundcloud"))).toBe(true);
        for (const platform of ["deezer", "appleMusic", "tidal", "spotify"]) {
            expect(ytdlp.canDownload(track(platform))).toBe(false);
        }
    });

    test("Soulseek takes any platform's track (it searches by name)", () => {
        const soulseek = makeDownloader("soulseek");
        for (const platform of ["deezer", "appleMusic", "tidal", "spotify", "youtube"]) {
            expect(soulseek.canDownload(track(platform))).toBe(true);
        }
    });

    test("the line the user reads names the platforms, and the ones switched off", () => {
        const ytdlp = downloadServiceRegistry.getConstructor("ytdlp");
        const info = downloadLinkInfo(ytdlp);
        expect(info.kind === "platforms" && info.platforms.map((p) => p.label)).toEqual(["YouTube", "SoundCloud"]);
        expect(describeDownloadLinks(info, (key) => key !== "soundcloud")).toBe(
            "Uses links from: YouTube, SoundCloud (off in Metadata)"
        );
        expect(
            describeDownloadLinks(downloadLinkInfo(downloadServiceRegistry.getConstructor("soulseek")), () => true)
        ).toMatch(/any platform/);
    });
});

describe("Settings → Download", () => {
    test("each download provider says which platforms' links it uses, under its name", async () => {
        const { buildMusicSettingsItems } = await import("#flows/musicDownloadFlow/buildFlowSettingsItems");
        const { computeDefaultMusicSettings } = await import("#flows/musicDownloadFlow/settings");
        const settings = computeDefaultMusicSettings();
        settings.metadata.providers.soundcloud = { enabled: false };
        const items = buildMusicSettingsItems(settings as never, () => {});
        const header = items.findIndex((i) => i.kind === "providerHeader" && i.label === "YtDlp");
        expect(items[header + 1]).toEqual({
            kind: "note",
            indent: 4,
            text: "Uses links from: YouTube, SoundCloud (off in Metadata)",
        });
        const soulseek = items.findIndex((i) => i.kind === "providerHeader" && i.label === "Soulseek");
        expect(items[soulseek + 1]).toMatchObject({ kind: "note", text: expect.stringMatching(/any platform/) });
    });
});

describe("dialogBridge.matrix", () => {
    afterEach(() => dialogBridge.setMatrixOpener(null));

    test("hands the dialog to the UI and answers every row's and column's value", async () => {
        let shown: MatrixDialog | undefined;
        dialogBridge.setMatrixOpener((dialog, resolve) => {
            shown = dialog;
            resolve({ rows: [false, true], columns: [true] });
        });
        const dialog: MatrixDialog = {
            title: "Pick",
            columns: { heading: "C", items: [{ key: "c", label: "C1", checked: false }] },
            rows: {
                heading: "R",
                items: [
                    { key: "a", label: "A", checked: true },
                    { key: "b", label: "B", checked: false },
                ],
            },
            cells: [{ row: "a", column: "c", mark: "x", strong: true }],
        };
        expect(await dialogBridge.matrix(dialog)).toEqual({ rows: [false, true], columns: [true] });
        expect(shown).toBe(dialog);
    });

    test("dismissed, or nobody to ask: null", async () => {
        const dialog: MatrixDialog = {
            title: "x",
            columns: { heading: "", items: [] },
            rows: { heading: "", items: [] },
            cells: [],
        };
        expect(await dialogBridge.matrix(dialog)).toBeNull();
        dialogBridge.setMatrixOpener((_dialog, resolve) => resolve(null));
        expect(await dialogBridge.matrix(dialog)).toBeNull();
    });
});

describe("the first-run provider picker", () => {
    const asked: MatrixDialog[] = [];
    let answers: MatrixAnswer[] = [];

    beforeEach(async () => {
        asked.length = 0;
        answers = [];
        dialogBridge.setMatrixOpener((dialog, resolve) => {
            asked.push(dialog);
            resolve(answers.shift() ?? null);
        });
        const { SettingsStore } = await import("#settings/settingsStore");
        SettingsStore.getInstance().patchMusicSettings({
            onboarding: { providersChosen: false },
            metadata: { providers: { soundcloud: { enabled: true }, cloudMusic: { enabled: false } } },
            download: { providers: { ytdlp: { enabled: true }, soulseek: { enabled: true } } },
        });
    });
    afterEach(() => dialogBridge.setMatrixOpener(null));

    async function settings() {
        const { getMusicSettings } = await import("#flows/musicDownloadFlow/settings");
        return getMusicSettings();
    }

    test("waits for the app to be ready, then asks once, metadata and download on one screen", async () => {
        appReady.reset();
        const { registerProviderOnboarding } = await import("#flows/musicDownloadFlow/providerOnboarding");
        answers = [{ rows: [true, false, true, true], columns: [true, false] }];
        registerProviderOnboarding();
        expect(asked).toHaveLength(0);
        appReady.markReady();
        await vi.waitFor(async () => expect((await settings()).onboarding.providersChosen).toBe(true));

        expect(asked).toHaveLength(1);
        expect(asked[0].rows.items.map((i) => i.label)).toEqual(["YouTube", "SoundCloud", "Deezer", "Cloud Music"]);
        expect(asked[0].rows.items.map((i) => i.checked)).toEqual([true, true, true, false]);
        expect(asked[0].columns.items.map((i) => i.label)).toEqual(["YtDlp", "Soulseek"]);

        const s = await settings();
        expect(s.metadata.providers.soundcloud.enabled).toBe(false);
        // Ticking a provider that sends data away is the user's answer to it.
        expect(s.metadata.providers.cloudMusic).toMatchObject({ enabled: true, consentAsked: true });
        expect(s.download.providers.soulseek.enabled).toBe(false);
    });

    test("the grid says whose links each download provider uses, in the platform's color", async () => {
        const { runProviderOnboarding } = await import("#flows/musicDownloadFlow/providerOnboarding");
        answers = [null];
        await runProviderOnboarding();
        const { cells, rows } = asked[0];
        const strong = cells.filter((c) => c.strong).map((c) => `${c.row}→${c.column}`);
        expect(strong).toEqual(["youtube→ytdlp", "soundcloud→ytdlp"]);
        // Soulseek searches every platform's tracks by name: a plain cell in every row.
        expect(cells.filter((c) => c.column === "soulseek").map((c) => c.row)).toEqual(rows.items.map((i) => i.key));
        expect(cells.find((c) => c.column === "soulseek")).toEqual({
            row: "youtube",
            column: "soulseek",
            mark: "by name",
        });
        expect(rows.items.find((i) => i.key === "youtube")?.color).toBe("#ff0033");
        expect(asked[0].columns.items[1].note).toMatch(/any platform/);
    });

    test("Esc keeps the providers as they are and is not asked again", async () => {
        const { runProviderOnboarding } = await import("#flows/musicDownloadFlow/providerOnboarding");
        answers = [null];
        await runProviderOnboarding();
        expect(asked).toHaveLength(1);
        expect((await settings()).metadata.providers.soundcloud.enabled).toBe(true);
        expect((await settings()).onboarding.providersChosen).toBe(true);
        await runProviderOnboarding();
        expect(asked).toHaveLength(1);
    });
});
