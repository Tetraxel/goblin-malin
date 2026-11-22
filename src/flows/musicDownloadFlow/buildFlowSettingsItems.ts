import { type DeepPartial } from "#utils/types";
import { type ProviderConstructorLike, type ProviderSettingsSchema } from "#base/providerSettings";
import { type ServiceRegistry } from "#base/service-registry";
import { type SetupWizardConfig, isSetupComplete } from "#base/setupWizard";
import { providerDisplayRegistry } from "#base/providerDisplay";
import { type SettingsItem } from "#settings/buildSettingsItems";
import { BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS, type MusicDownloadFlowSettings } from "./settings";
import { metadataServiceRegistry, discoveryServiceRegistry, downloadServiceRegistry } from "./registries";
import { runTempCleanup } from "./tempCleanupFlow";
import { describeDownloadLinks, downloadLinkInfo } from "./downloadLinks";
import { chatStore } from "./agent/chatStore";
import { DEFAULT_CLAUDE_MODEL } from "./services/apis/claude-client";
import { AGENT_MODELS } from "./agent/chooseAgentModel";
import { OUTPUT_FORMATS, OUTPUT_FORMAT_KEYS, parseOutputFormat } from "./utils/outputFormat";
import { DOWNLOAD_STRATEGY_KEYS, DOWNLOAD_STRATEGY_NOTES, parseDownloadStrategy } from "./utils/downloadStrategy";
import { appSecrets } from "#base/appSecrets";
import { globalLogger } from "#base/logger/logger";

export type ProviderEntry = {
    key: string;
    ctor: ProviderConstructorLike;
};

function schemaOf(ctor: ProviderConstructorLike): ProviderSettingsSchema {
    return ctor.defaultSettings ?? { enabled: { label: "Enable", defaultValue: true, kind: "checkbox" } };
}

function hasMissingCredentials(ctor: ProviderConstructorLike): boolean {
    if (!ctor.setupWizard) return false;
    return ctor.setupWizard.fields.some((f) => f.required !== false && !appSecrets.get(f.envVar)?.trim());
}

function providerItems(
    key: string,
    ctor: ProviderConstructorLike,
    stored: Record<string, boolean | string>,
    onChange: (patch: DeepPartial<MusicDownloadFlowSettings>) => void,
    section: "metadata" | "download",
    providerSubKey: string,
    onOpenWizard: (config: SetupWizardConfig, onDisable?: () => void) => void,
    status: string | undefined
): SettingsItem[] {
    const display = providerDisplayRegistry.get(key);
    const schema = schemaOf(ctor);
    const items: SettingsItem[] = [
        {
            kind: "providerHeader",
            label: display.label,
            color: display.color,
            missingCredentials: hasMissingCredentials(ctor),
        },
    ];

    if (ctor.setupWizard) {
        const wizard = ctor.setupWizard;
        items.push({
            kind: "action",
            indent: 4,
            icon: "⚙",
            label: "Setup Wizard",
            run: () =>
                onOpenWizard(wizard, () =>
                    onChange({
                        [section]: { [providerSubKey]: { [key]: { enabled: false } } },
                    } as DeepPartial<MusicDownloadFlowSettings>)
                ),
        });
        // What finishing the setup would unlock — only while it is unfinished.
        if (wizard.benefits && !isSetupComplete(wizard)) {
            items.push({ kind: "note", indent: 4, text: wizard.benefits });
        }
    }

    for (const [settingKey, def] of Object.entries(schema)) {
        if (def.kind === "checkbox") {
            const current = (stored[settingKey] as boolean) ?? def.defaultValue;
            // Flipping a consent-gated provider's switch is an explicit answer: never ask again.
            const answersConsent = ctor.consent !== undefined && settingKey === "enabled";
            items.push({
                kind: "checkbox",
                indent: 4,
                label: def.label,
                get: () => current,
                set: (v) =>
                    onChange({
                        [section]: {
                            [providerSubKey]: {
                                [key]: answersConsent ? { [settingKey]: v, consentAsked: true } : { [settingKey]: v },
                            },
                        },
                    } as DeepPartial<MusicDownloadFlowSettings>),
            });
        } else if (def.kind === "select") {
            const storedValue = stored[settingKey] as string | undefined;
            const current =
                storedValue !== undefined && def.options.includes(storedValue) ? storedValue : def.defaultValue;
            items.push({
                kind: "select",
                indent: 4,
                label: def.label,
                options: def.options,
                get: () => current,
                set: (v) =>
                    onChange({
                        [section]: { [providerSubKey]: { [key]: { [settingKey]: v } } },
                    } as DeepPartial<MusicDownloadFlowSettings>),
            });
        } else if (def.kind === "textInput") {
            const current = (stored[settingKey] as string) ?? def.defaultValue;
            items.push({
                kind: "textInput",
                indent: 4,
                label: def.label,
                get: () => current,
                set: (v) =>
                    onChange({
                        [section]: { [providerSubKey]: { [key]: { [settingKey]: v } } },
                    } as DeepPartial<MusicDownloadFlowSettings>),
            });
        }
    }

    // What the provider adds of its own (an import button, a line about a file on disk).
    for (const row of ctor.settingsRows?.(stored, status) ?? []) {
        if (row.kind === "note") {
            items.push({ kind: "note", indent: 4, text: row.text });
        } else {
            items.push({
                kind: "action",
                indent: 4,
                label: row.label,
                icon: row.icon,
                run: () => {
                    Promise.resolve()
                        .then(() => row.run())
                        .catch((error) => globalLogger.error(`Settings action "${row.label}" failed`, { error }));
                },
            });
        }
    }

    return items;
}

/** Values the rows need that are not settings — worked out by the caller, possibly after the modal opened. */
export type FlowSettingsExtras = {
    /** The temporary folder's size, as text; `undefined` while it is still being measured. */
    tempUsageText?: string;
    /** What each provider's `settingsStatus` answered, by registry key (missing until it has). */
    providerStatus?: Record<string, string | undefined>;
};

/** Asks every provider that has a `settingsStatus` for it. A provider that fails is left out, never thrown. */
export async function loadProviderStatuses(): Promise<Record<string, string | undefined>> {
    const entries: [string, ProviderConstructorLike][] = [];
    for (const registry of [metadataServiceRegistry, discoveryServiceRegistry, downloadServiceRegistry]) {
        for (const [key, ctor] of registry.getAllConstructors()) entries.push([key, ctor as ProviderConstructorLike]);
    }
    const answers = await Promise.all(
        entries.map(async ([key, ctor]) => {
            try {
                return [key, await ctor.settingsStatus?.()] as const;
            } catch (error) {
                globalLogger.warn(`Could not read the settings status of ${key}`, { error });
                return [key, undefined] as const;
            }
        })
    );
    return Object.fromEntries(answers.filter(([, text]) => text !== undefined));
}

export function buildFlowSettingsItems(
    flowSettings: MusicDownloadFlowSettings,
    metadataProviders: ProviderEntry[],
    downloadProviders: ProviderEntry[],
    discoveryProviders: ProviderEntry[],
    onChange: (patch: DeepPartial<MusicDownloadFlowSettings>) => void,
    onOpenWizard: (config: SetupWizardConfig, onDisable?: () => void) => void = () => {},
    extras: FlowSettingsExtras = {}
): SettingsItem[] {
    const items: SettingsItem[] = [];

    // ── Metadata ──────────────────────────────────────────────────
    items.push({ kind: "sectionHeader", label: "Metadata" });

    if (metadataProviders.length > 0) {
        items.push({ kind: "subHeader", label: "Providers" });
        for (const { key, ctor } of metadataProviders) {
            items.push(
                ...providerItems(
                    key,
                    ctor,
                    flowSettings.metadata.providers[key] ?? {},
                    onChange,
                    "metadata",
                    "providers",
                    onOpenWizard,
                    extras.providerStatus?.[key]
                )
            );
        }
    }

    if (discoveryProviders.length > 0) {
        items.push({ kind: "subHeader", label: "Discovery providers" });
        for (const { key, ctor } of discoveryProviders) {
            items.push(
                ...providerItems(
                    key,
                    ctor,
                    flowSettings.metadata.discoveryProviders[key] ?? {},
                    onChange,
                    "metadata",
                    "discoveryProviders",
                    onOpenWizard,
                    extras.providerStatus?.[key]
                )
            );
        }
    }

    // ── MusicBrainz ───────────────────────────────────────────────
    // Over the defaults, so a caller holding settings from before this section existed still gets working rows.
    const mb = { ...BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS.musicBrainz, ...flowSettings.musicBrainz };
    items.push({ kind: "sectionHeader", label: "MusicBrainz" });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Find each track's MusicBrainz release (read-only lookups)",
        get: () => mb.matchTracks,
        set: (v) => onChange({ musicBrainz: { matchTracks: v } }),
    });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Write MusicBrainz IDs into saved files",
        get: () => mb.includeTags,
        set: (v) => onChange({ musicBrainz: { includeTags: v } }),
    });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Allow adding missing releases to MusicBrainz",
        // Flipping the switch is an explicit answer: never ask again.
        get: () => mb.contribute,
        set: (v) => onChange({ musicBrainz: { contribute: v, contributeAsked: true } }),
    });
    items.push({
        kind: "note",
        indent: 0,
        text: "Nothing is submitted by the app: MusicBrainz opens in your browser and you press “Enter edit” yourself.",
    });
    items.push({
        kind: "select",
        indent: 0,
        label: "Add releases via",
        options: ["harmony", "direct"],
        get: () => (mb.contributeVia === "direct" ? "direct" : "harmony"),
        set: (v) => onChange({ musicBrainz: { contributeVia: v } }),
    });
    items.push({
        kind: "note",
        indent: 0,
        text:
            mb.contributeVia === "direct"
                ? "direct: the app fills MusicBrainz' editor itself and learns the new release when you are done."
                : "harmony: Harmony (a public import tool) checks for duplicates and fills the editor; press Re-check afterwards.",
    });
    items.push({
        kind: "textInput",
        indent: 0,
        label: "Harmony address",
        get: () => mb.harmonyUrl,
        set: (v) => onChange({ musicBrainz: { harmonyUrl: v } }),
    });
    items.push({
        kind: "textInput",
        indent: 0,
        label: "MusicBrainz Picard port (its browser integration)",
        get: () => mb.picardPort,
        set: (v) => onChange({ musicBrainz: { picardPort: v } }),
    });

    // ── Claude agent (P32) ────────────────────────────────────────
    const agent = { ...BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS.agent, ...flowSettings.agent };
    items.push({ kind: "sectionHeader", label: "Claude agent (chat)" });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Let Claude read and change my tasks, when I ask in the chat (uses your Claude plan)",
        // Flipping the switch is an explicit answer: never ask again.
        get: () => agent.enabled,
        set: (v) => onChange({ agent: { enabled: v, consentAsked: true } }),
    });
    items.push({
        kind: "select",
        indent: 0,
        label: "Model",
        // A full model name saved earlier is what the agent really runs: it stays listed (and shown) instead of
        // being displayed as the default.
        options:
            agent.model && !(AGENT_MODELS as readonly string[]).includes(agent.model)
                ? [...AGENT_MODELS, agent.model]
                : AGENT_MODELS,
        get: () => agent.model || DEFAULT_CLAUDE_MODEL,
        set: (v) => onChange({ agent: { model: v } }),
    });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Keep a log of the conversations and the tool calls (agent.log, in the data folder)",
        get: () => agent.keepLog !== false,
        set: (v) => onChange({ agent: { keepLog: v } }),
    });
    items.push({
        kind: "note",
        indent: 0,
        text: "Uses the Claude CLI command set under Discovery providers → Claude. It never sees your files or the web, only the tools of the chat.",
    });
    const usage = chatStore.getSnapshot().usage;
    items.push({
        kind: "readonlyText",
        indent: 0,
        label: "Used since launch",
        value:
            usage.messages === 0
                ? "nothing yet"
                : `${usage.messages} message${usage.messages === 1 ? "" : "s"}, ${usage.turns} model turn${usage.turns === 1 ? "" : "s"}, about $${usage.costUsd.toFixed(3)} at list price`,
    });

    // ── Collections (albums/playlists) ─────────────────────────────
    items.push({ kind: "sectionHeader", label: "Collections" });
    items.push({
        kind: "textInput",
        indent: 0,
        label: "Max tracks imported per album/playlist",
        get: () => String(flowSettings.collections.defaultMaxTracks),
        set: (v) => {
            const n = Math.max(1, Math.round(Number(v)));
            if (Number.isFinite(n)) onChange({ collections: { defaultMaxTracks: n } });
        },
    });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Explain why a playlist can't be read (e.g. private)",
        get: () => flowSettings.collections.showAccessHints,
        set: (v) => onChange({ collections: { showAccessHints: v } }),
    });
    items.push({
        kind: "textInput",
        indent: 0,
        label: "Live playlist refresh interval (seconds)",
        get: () => String(flowSettings.collections.defaultLiveRefreshIntervalSeconds),
        set: (v) => {
            const n = Math.max(1, Math.round(Number(v)));
            if (Number.isFinite(n)) onChange({ collections: { defaultLiveRefreshIntervalSeconds: n } });
        },
    });

    // ── Download ──────────────────────────────────────────────────
    items.push({ kind: "sectionHeader", label: "Download" });
    const strategy = parseDownloadStrategy(flowSettings.download.downloadStrategy);
    items.push({
        kind: "select",
        indent: 0,
        label: "Download strategy",
        options: DOWNLOAD_STRATEGY_KEYS,
        get: () => strategy,
        set: (v) => onChange({ download: { downloadStrategy: v } }),
    });
    items.push({ kind: "note", indent: 0, text: DOWNLOAD_STRATEGY_NOTES[strategy] });
    items.push({
        kind: "textInput",
        indent: 0,
        icon: "⌂",
        label: "Default output directory",
        get: () => flowSettings.download.outputDir,
        set: (v) => onChange({ download: { outputDir: v } }),
    });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Convert every download to one audio format",
        get: () => flowSettings.download.convertAudio,
        set: (v) => onChange({ download: { convertAudio: v } }),
    });
    if (flowSettings.download.convertAudio) {
        const format = parseOutputFormat(flowSettings.download.convertFormat);
        items.push({
            kind: "select",
            // Nested under the checkbox above it: its label starts 3 columns right of the checkbox label.
            indent: 3,
            label: "Convert to",
            options: OUTPUT_FORMAT_KEYS,
            get: () => format,
            set: (v) => onChange({ download: { convertFormat: v } }),
        });
        items.push({
            kind: "note",
            indent: 0,
            text: OUTPUT_FORMATS[format].lossless
                ? "A lossy source (YouTube, MP3…) keeps its quality: FLAC adds none."
                : `Encoded at about ${OUTPUT_FORMATS[format].kbps} kbps; a lossless source loses quality.`,
        });
    } else {
        items.push({
            kind: "note",
            indent: 0,
            text: "Each track keeps the format it was downloaded in.",
        });
    }
    items.push({
        kind: "textInput",
        indent: 0,
        icon: "⌂",
        label: "Temporary download directory",
        get: () => flowSettings.download.outputTemporaryDir,
        set: (v) => onChange({ download: { outputTemporaryDir: v } }),
    });
    items.push({
        kind: "action",
        indent: 0,
        icon: "✕",
        label: "Clear temporary downloads…",
        run: () => void runTempCleanup("manual", flowSettings.download.outputTemporaryDir),
    });
    items.push({ kind: "note", indent: 0, text: extras.tempUsageText ?? "calculating…" });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Remind me to clean up unused temporary downloads",
        get: () => flowSettings.download.tempCleanupReminder,
        set: (v) => onChange({ download: { tempCleanupReminder: v } }),
    });
    items.push({
        kind: "checkbox",
        indent: 0,
        label: "Delete temporary downloads unused for 48 h automatically",
        get: () => flowSettings.download.autoDeleteUnusedTemp,
        set: (v) => onChange({ download: { autoDeleteUnusedTemp: v } }),
    });

    if (downloadProviders.length > 0) {
        items.push({ kind: "subHeader", label: "Providers" });
        const metadataEnabled = (platform: string) => flowSettings.metadata.providers[platform]?.enabled !== false;
        for (const { key, ctor } of downloadProviders) {
            const [header, ...rest] = providerItems(
                key,
                ctor,
                flowSettings.download.providers[key] ?? {},
                onChange,
                "download",
                "providers",
                onOpenWizard,
                extras.providerStatus?.[key]
            );
            // Which platforms' links it downloads: a metadata platform the user left off may still be a source of files.
            const links = describeDownloadLinks(downloadLinkInfo(ctor), metadataEnabled);
            items.push(header, { kind: "note", indent: 4, text: links }, ...rest);
        }
    }

    return items;
}

/** Settings rows for the music downloader, sourced from the live provider registries. */
export function buildMusicSettingsItems(
    settings: Record<string, unknown>,
    onChange: (patch: Record<string, unknown>) => void,
    onOpenWizard?: (config: SetupWizardConfig, onDisable?: () => void) => void,
    extras?: FlowSettingsExtras
): SettingsItem[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toEntries = (registry: ServiceRegistry<any, any>): ProviderEntry[] =>
        Array.from(registry.getAllConstructors().keys()).map((key) => ({
            key,
            ctor: registry.getConstructor(key) as ProviderConstructorLike,
        }));

    return buildFlowSettingsItems(
        settings as MusicDownloadFlowSettings,
        toEntries(metadataServiceRegistry),
        toEntries(downloadServiceRegistry),
        toEntries(discoveryServiceRegistry),
        onChange as (patch: DeepPartial<MusicDownloadFlowSettings>) => void,
        onOpenWizard,
        extras
    );
}
