import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { dialogBridge, type ListDialog, type ListDialogAnswer } from "#base/bridges/dialogBridge";
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
    const { AmazonMusicService } =
        await import("#flows/musicDownloadFlow/services/metadata-providers/amazonMusic/AmazonMusicService");
    const { YtDlpService } = await import("#flows/musicDownloadFlow/services/download-providers/ytdlp/YtDlpService");
    const { SoulseekService } =
        await import("#flows/musicDownloadFlow/services/download-providers/soulseek/SoulseekService");
    metadataServiceRegistry.register("youtube", YoutubeService);
    metadataServiceRegistry.register("soundcloud", SoundCloudService);
    metadataServiceRegistry.register("deezer", DeezerService);
    metadataServiceRegistry.register("amazonMusic", AmazonMusicService);
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
        for (const platform of ["deezer", "appleMusic", "tidal", "amazonMusic", "spotify"]) {
            expect(ytdlp.canDownload(track(platform))).toBe(false);
        }
    });

    test("Soulseek takes any platform's track (it searches by name)", () => {
        const soulseek = makeDownloader("soulseek");
        for (const platform of ["deezer", "appleMusic", "tidal", "amazonMusic", "spotify", "youtube"]) {
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

describe("dialogBridge.checklist", () => {
    afterEach(() => dialogBridge.setListOpener(null));

    test("opens a list with a box per row and answers every row's value", async () => {
        let shown: ListDialog | undefined;
        dialogBridge.setListOpener((dialog, resolve) => {
            shown = dialog;
            resolve({ checked: [false, true] });
        });
        const answer = await dialogBridge.checklist({
            title: "Pick",
            items: [
                { label: "A", checked: true },
                { label: "B", checked: false },
            ],
        });
        expect(shown?.checked).toEqual([true, false]);
        expect(shown?.items.map((i) => i.label)).toEqual(["A", "B"]);
        expect(answer).toEqual([false, true]);
    });

    test("dismissed, or nobody to ask: null", async () => {
        expect(await dialogBridge.checklist({ title: "x", items: [] })).toBeNull();
        dialogBridge.setListOpener((_dialog, resolve) => resolve(null));
        expect(await dialogBridge.checklist({ title: "x", items: [] })).toBeNull();
    });
});

describe("the first-run provider picker", () => {
    const asked: ListDialog[] = [];
    let answers: ListDialogAnswer[] = [];

    beforeEach(async () => {
        asked.length = 0;
        answers = [];
        dialogBridge.setListOpener((dialog, resolve) => {
            asked.push(dialog);
            resolve(answers.shift() ?? null);
        });
        const { SettingsStore } = await import("#settings/settingsStore");
        SettingsStore.getInstance().patchMusicSettings({
            onboarding: { providersChosen: false },
            metadata: { providers: { soundcloud: { enabled: true }, amazonMusic: { enabled: false } } },
            download: { providers: { ytdlp: { enabled: true }, soulseek: { enabled: true } } },
        });
    });
    afterEach(() => dialogBridge.setListOpener(null));

    async function settings() {
        const { getMusicSettings } = await import("#flows/musicDownloadFlow/settings");
        return getMusicSettings();
    }

    test("waits for the app to be ready, then asks once: metadata, then download", async () => {
        appReady.reset();
        const { registerProviderOnboarding } = await import("#flows/musicDownloadFlow/providerOnboarding");
        answers = [{ checked: [true, false, true, true] }, { checked: [true, false] }];
        registerProviderOnboarding();
        expect(asked).toHaveLength(0);
        appReady.markReady();
        await vi.waitFor(async () => expect((await settings()).onboarding.providersChosen).toBe(true));

        expect(asked.map((d) => d.title)).toEqual(["Which platforms do you use?", "How should tracks be downloaded?"]);
        expect(asked[0].items.map((i) => i.label)).toEqual(["YouTube", "SoundCloud", "Deezer", "Amazon Music"]);
        expect(asked[0].checked).toEqual([true, true, true, false]);

        const s = await settings();
        expect(s.metadata.providers.soundcloud.enabled).toBe(false);
        // Ticking a provider that sends data away is the user's answer to it.
        expect(s.metadata.providers.amazonMusic).toMatchObject({ enabled: true, consentAsked: true });
        expect(s.download.providers.soulseek.enabled).toBe(false);
    });

    test("the download step shows the platforms each provider uses, and which were just left off", async () => {
        const { runProviderOnboarding } = await import("#flows/musicDownloadFlow/providerOnboarding");
        answers = [{ checked: [true, false, true, false] }, null];
        await runProviderOnboarding();
        const ytdlp = asked[1].items[0];
        expect(ytdlp.label).toBe("YtDlp");
        expect(ytdlp.detail).toContain("Uses links from: YouTube, SoundCloud (off in Metadata)");
        expect(ytdlp.detail?.some((line) => /Turn SoundCloud on in Metadata/.test(line))).toBe(true);
        // A metadata row says who downloads its tracks.
        expect(asked[0].items[2].detail).toContain("No download from its links; found by name by: Soulseek");
        expect(asked[0].items[1].detail).toContain("Its links are downloaded by: YtDlp");
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
