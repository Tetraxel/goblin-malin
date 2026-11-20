import { appReady } from "#base/appReady";
import { dialogBridge, type ListItem } from "#base/bridges/dialogBridge";
import { globalLogger } from "#base/logger/logger";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { type ProviderConstructorLike } from "#base/providerSettings";
import { SettingsStore } from "#settings/settingsStore";
import { describeDownloadLinks, downloadLinkInfo } from "./downloadLinks";
import { downloadServiceRegistry, metadataServiceRegistry } from "./registries";
import { getMusicSettings, type StoredProviderSettings } from "./settings";

const logger = globalLogger.createChild({ service: "ProviderOnboarding" });

type Entry = { key: string; ctor: ProviderConstructorLike };

function entriesOf(registry: typeof metadataServiceRegistry | typeof downloadServiceRegistry): Entry[] {
    return [...registry.getAllConstructors()].map(([key, ctor]) => ({ key, ctor: ctor as ProviderConstructorLike }));
}

/** Whether a provider is on: what the user stored, else its declared default. */
function isOn(ctor: ProviderConstructorLike, stored: StoredProviderSettings | undefined): boolean {
    const value = stored?.enabled;
    if (typeof value === "boolean") return value;
    const def = ctor.defaultSettings?.enabled;
    return def?.kind === "checkbox" ? def.defaultValue : true;
}

/** The settings patch of one provider's answer. Ticking a consent-gated provider is the user's answer to it. */
function answerPatch(ctor: ProviderConstructorLike, enabled: boolean): StoredProviderSettings {
    return ctor.consent ? { enabled, consentAsked: true } : { enabled };
}

/** The download providers that can download a platform's tracks: by its links, or by searching its tracks' names. */
function downloadersOf(platform: string): { byLink: string[]; byName: string[] } {
    const byLink: string[] = [];
    const byName: string[] = [];
    for (const { key, ctor } of entriesOf(downloadServiceRegistry)) {
        const label = providerDisplayRegistry.get(key).label || key;
        if (ctor.linkPlatforms === "any") byName.push(label);
        else if (ctor.linkPlatforms?.includes(platform)) byLink.push(label);
    }
    return { byLink, byName };
}

/** The lines under a metadata provider: what it does, what it sends away, and who can download its tracks. */
export function metadataItemDetail(key: string, ctor: ProviderConstructorLike): string[] {
    const lines: string[] = [];
    if (ctor.summary) lines.push(ctor.summary);
    if (ctor.consent) lines.push(`Off by default: ${ctor.consent.title}`);
    if (ctor.setupWizard) lines.push("Asks for its setup (an account or a key) the first time it is needed.");
    const { byLink, byName } = downloadersOf(key);
    if (byLink.length > 0) lines.push(`Its links are downloaded by: ${byLink.join(", ")}`);
    else if (byName.length > 0) lines.push(`No download from its links; found by name by: ${byName.join(", ")}`);
    return lines;
}

/** The lines under a download provider: what it does, and the platforms whose links it uses (and which are off). */
export function downloadItemDetail(
    ctor: ProviderConstructorLike,
    isPlatformOn: (platform: string) => boolean
): string[] {
    const lines: string[] = [];
    if (ctor.summary) lines.push(ctor.summary);
    if (ctor.setupWizard) lines.push("Asks for its setup (an account) the first time it is needed.");
    const info = downloadLinkInfo(ctor);
    lines.push(describeDownloadLinks(info, isPlatformOn));
    if (info.kind === "platforms") {
        const off = info.platforms.filter((p) => !isPlatformOn(p.key)).map((p) => p.label);
        if (off.length > 0) {
            lines.push(`Turn ${off.join(" / ")} on in Metadata to give it more to download, even unused.`);
        }
    }
    return lines;
}

/**
 * The first-run question, asked once after the welcome intro: which metadata providers to use, then which download
 * providers, each with what it does and — for a download provider — the platforms whose links it uses, so a platform
 * the user would not pick for itself shows up as a source of files. The answers are written to the providers'
 * settings (Settings → Metadata / Download change them later). Esc keeps what is set and is not asked again.
 */
export async function runProviderOnboarding(): Promise<void> {
    if (getMusicSettings().onboarding?.providersChosen) return;
    const store = SettingsStore.getInstance();
    const markAsked = () => store.patchMusicSettings({ onboarding: { providersChosen: true } });

    // ── Metadata providers ──
    const metadata = entriesOf(metadataServiceRegistry);
    const storedMetadata = getMusicSettings().metadata.providers;
    const metadataItems: (ListItem & { checked: boolean })[] = metadata.map(({ key, ctor }) => ({
        label: providerDisplayRegistry.get(key).label || key,
        detail: metadataItemDetail(key, ctor),
        checked: isOn(ctor, storedMetadata[key]),
    }));
    const metadataAnswer = await dialogBridge.checklist({
        title: "Which platforms do you use?",
        intro:
            "Metadata providers read your links and find each track on the other platforms. " +
            "Tick the ones to use; Settings → Metadata changes this later.",
        items: metadataItems,
        confirmLabel: "Next",
    });
    if (!metadataAnswer) {
        logger.info("Provider picker dismissed: keeping the current providers");
        markAsked();
        return;
    }
    store.patchMusicSettings({
        metadata: {
            providers: Object.fromEntries(
                metadata.map(({ key, ctor }, i) => [key, answerPatch(ctor, metadataAnswer[i])])
            ),
        },
    });
    const platformOn = new Map(metadata.map(({ key }, i) => [key, metadataAnswer[i]]));
    const isPlatformOn = (platform: string) => platformOn.get(platform) ?? false;

    // ── Download providers ──
    const download = entriesOf(downloadServiceRegistry);
    const storedDownload = getMusicSettings().download.providers;
    const downloadAnswer = await dialogBridge.checklist({
        title: "How should tracks be downloaded?",
        intro:
            "Download providers fetch the audio file, each from the links of some platforms. " +
            "A platform you left off can still be where a file comes from.",
        items: download.map(({ key, ctor }) => ({
            label: providerDisplayRegistry.get(key).label || key,
            detail: downloadItemDetail(ctor, isPlatformOn),
            checked: isOn(ctor, storedDownload[key]),
        })),
        confirmLabel: "Save",
    });
    if (downloadAnswer) {
        store.patchMusicSettings({
            download: {
                providers: Object.fromEntries(
                    download.map(({ key, ctor }, i) => [key, answerPatch(ctor, downloadAnswer[i])])
                ),
            },
        });
    }
    markAsked();
    logger.info("Providers chosen on first launch");
}

/** Asks the first-run question once the app is on screen (see `appReady`). Called by `initMusicApp()`. */
export function registerProviderOnboarding(): void {
    appReady.whenReady(() => {
        runProviderOnboarding().catch((error) => logger.error("The provider picker failed", { error }));
    });
}
