import { appReady } from "#base/appReady";
import { dialogBridge, type MatrixCell } from "#base/bridges/dialogBridge";
import { globalLogger } from "#base/logger/logger";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { type ProviderConstructorLike } from "#base/providerSettings";
import { SettingsStore } from "#settings/settingsStore";
import { describeLinkSources, downloadLinkInfo } from "./downloadLinks";
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

/**
 * The settings patch of one provider's answer. None of the providers the picker lists asks consent today (Songlink and
 * Claude are discovery services, not listed); a listed provider that did would take the tick as its answer.
 */
function answerPatch(ctor: ProviderConstructorLike, enabled: boolean): StoredProviderSettings {
    return ctor.consent ? { enabled, consentAsked: true } : { enabled };
}

/** The lines under the grid for a metadata provider: what it does, what it sends away, its setup. */
export function metadataItemDetail(ctor: ProviderConstructorLike): string[] {
    const lines: string[] = [];
    if (ctor.summary) lines.push(ctor.summary);
    if (ctor.consent) lines.push(`Off by default: ${ctor.consent.title}`);
    if (ctor.setupWizard) lines.push("Asks for its setup (an account or a key) the first time it is needed.");
    return lines;
}

/** The lines under the grid for a download provider: what it does, its setup. */
export function downloadItemDetail(ctor: ProviderConstructorLike): string[] {
    const lines: string[] = [];
    if (ctor.summary) lines.push(ctor.summary);
    if (ctor.setupWizard) lines.push("Asks for its setup (an account) the first time it is needed.");
    return lines;
}

/**
 * What joins each platform to each download provider (its `static linkPlatforms`): "link" when the provider downloads
 * the platform's own links (strong: drawn in the platform's color), "by name" when it searches the platform's tracks
 * by artist and title.
 */
export function providerCells(metadata: Entry[], download: Entry[]): MatrixCell[] {
    const cells: MatrixCell[] = [];
    for (const { key: column, ctor } of download) {
        const info = downloadLinkInfo(ctor);
        for (const { key: row } of metadata) {
            if (info.kind === "any") cells.push({ row, column, mark: "by name" });
            else if (info.kind === "platforms" && info.platforms.some((p) => p.key === row)) {
                cells.push({ row, column, mark: "● link", strong: true });
            }
        }
    }
    return cells;
}

const labelOf = (key: string) => providerDisplayRegistry.get(key).label || key;

/**
 * The first-run question, asked once after the welcome intro, on one screen: which download providers and which
 * metadata providers (platforms) to use, and — in a grid, in each platform's color — whose links each download
 * provider will use, so a platform the user would not pick for itself shows up as a source of files and unticking it
 * greys out what is lost. The answers are written to the providers' settings (Settings → Metadata / Download change
 * them later). Esc keeps what is set and is not asked again.
 */
export async function runProviderOnboarding(): Promise<void> {
    if (getMusicSettings().onboarding?.providersChosen) return;
    const store = SettingsStore.getInstance();
    const markAsked = () => store.patchMusicSettings({ onboarding: { providersChosen: true } });

    const metadata = entriesOf(metadataServiceRegistry);
    const download = entriesOf(downloadServiceRegistry);
    const { metadata: storedMetadata, download: storedDownload } = getMusicSettings();

    let unanswerable = false;
    const answer = await dialogBridge.matrix(
        {
            title: "Choose your providers",
            intro:
                "Metadata providers read the links you paste and find each track on the other platforms; download " +
                "providers fetch the audio file. A platform's links are only used while both are ticked (in color). " +
                "Settings → Metadata / Download change this later.",
            columns: {
                heading: "Download providers",
                items: download.map(({ key, ctor }) => ({
                    key,
                    label: labelOf(key),
                    color: providerDisplayRegistry.get(key).color,
                    checked: isOn(ctor, storedDownload.providers[key]),
                    detail: downloadItemDetail(ctor),
                    note: describeLinkSources(downloadLinkInfo(ctor), () => true),
                })),
            },
            rows: {
                heading: "Metadata providers",
                items: metadata.map(({ key, ctor }) => ({
                    key,
                    label: labelOf(key),
                    color: providerDisplayRegistry.get(key).color,
                    checked: isOn(ctor, storedMetadata.providers[key]),
                    detail: metadataItemDetail(ctor),
                })),
            },
            cells: providerCells(metadata, download),
            columnLinksLabel: "links from",
        },
        {
            onUnanswerable: () => {
                unanswerable = true;
            },
        }
    );
    if (!answer) {
        // The UI went away (the app is closing) before the user saw it: ask again next time.
        if (unanswerable) {
            logger.info("Provider picker could not be shown: it will be asked again");
            return;
        }
        logger.info("Provider picker dismissed: keeping the current providers");
        markAsked();
        return;
    }
    store.patchMusicSettings({
        metadata: {
            providers: Object.fromEntries(metadata.map(({ key, ctor }, i) => [key, answerPatch(ctor, answer.rows[i])])),
        },
        download: {
            providers: Object.fromEntries(
                download.map(({ key, ctor }, i) => [key, answerPatch(ctor, answer.columns[i])])
            ),
        },
        onboarding: { providersChosen: true },
    });
    logger.info("Providers chosen on first launch");
}

/** Asks the first-run question once the app is on screen (see `appReady`). Called by `initMusicApp()`. */
export function registerProviderOnboarding(): void {
    appReady.whenReady(() => {
        runProviderOnboarding().catch((error) => logger.error("The provider picker failed", { error }));
    });
}
