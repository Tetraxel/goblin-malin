import { dialogBridge, type ListItem } from "#base/bridges/dialogBridge";
import { type ProviderSettingsRow } from "#base/providerSettings";
import { globalLogger } from "#base/logger/logger";
import { formatSize } from "#utils/formatBytes";
import { getMusicSettings, saveMusicSettings } from "../../../settings";
import { stemActivity } from "../../../stems/stemActivity";
import { stemKindRegistry } from "../../../stems/stemKinds";
import { type StemDevice, type StemModel } from "../../../stems/stemService";
import { getStemProviderSettings } from "../../../stems/stemProviders";
import { AUDIO_SEPARATOR_VERSION, audioSeparatorEngine } from "./engine";

/** The registry key the service is registered under (`initMusicApp`): its settings are stored there. */
export const AUDIO_SEPARATOR_KEY = "audioSeparator";
/** The model a first separation uses: Demucs v4 fine-tuned, 4 stems (P33 spike: 39 s for a 3½ min track on an RTX 3080). */
export const DEFAULT_AUDIO_SEPARATOR_MODEL = "htdemucs_ft.yaml";

/** Sizes measured in the P33 spike (Windows, audio-separator 0.48.0): what the install dialog announces. */
const INSTALL_SIZE: Record<StemDevice, string> = { cuda: "3.7 GB", cpu: "1 GB" };

function saveProviderSetting(patch: Record<string, string | boolean>): void {
    const settings = getMusicSettings();
    const providers = settings.stems?.providers ?? {};
    saveMusicSettings({
        ...settings,
        stems: {
            ...settings.stems,
            providers: { ...providers, [AUDIO_SEPARATOR_KEY]: { ...providers[AUDIO_SEPARATOR_KEY], ...patch } },
        },
    });
}

/**
 * Models worth trying first for 4 stems, best known first, with why (shown under the model in the lists). The list of
 * audio-separator has 170 models, most of them for vocals / instrumental only.
 */
export const RECOMMENDED_STEM_MODELS: Readonly<Record<string, string>> = {
    "htdemucs_ft.yaml": "★ Recommended: the best 4-stem Demucs (vocals, drums, bass, other), 336 MB",
    "BS-Roformer-SW.ckpt":
        "★ Also try: a newer 6-stem RoFormer (guitar and piano come out of “other”), slower and heavier",
};

function describeModel(model: StemModel): string[] {
    const stems = model.stems.length
        ? model.stems.map((kind) => stemKindRegistry.get(kind).label).join(", ")
        : "stems not listed (known after a run)";
    const recommended = RECOMMENDED_STEM_MODELS[model.id];
    return [
        ...(recommended ? [recommended] : []),
        `${model.family} · ${stems}`,
        model.downloaded ? `Downloaded (${formatSize(model.sizeBytes ?? 0)})` : "Not downloaded",
    ];
}

/**
 * The recommended models first (in their order), then those with 4 or more stems (the Stems view's set), then the
 * others, each group by name.
 */
export function sortModels(models: StemModel[]): StemModel[] {
    const recommended = Object.keys(RECOMMENDED_STEM_MODELS);
    const rank = (m: StemModel) => {
        const r = recommended.indexOf(m.id);
        if (r !== -1) return r;
        return recommended.length + (m.stems.length >= 4 ? 0 : m.stems.length === 0 ? 2 : 1);
    };
    return [...models].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

async function tellFailure(title: string, error: unknown): Promise<void> {
    await dialogBridge.confirm({
        title,
        message: error instanceof Error ? error.message : String(error),
        choices: [{ label: "OK", tone: "primary" }],
    });
}

/** "Install…": asks which build, says how much will be downloaded, and installs. */
export async function installInteractively(): Promise<void> {
    const gpu = await audioSeparatorEngine.detectGpu();
    const status = await audioSeparatorEngine.status();
    const intro = [
        "Stem separation runs audio-separator (the engine of Ultimate Vocal Remover) on this computer. Nothing is uploaded.",
        "",
        `uv downloads its own Python and audio-separator ${AUDIO_SEPARATOR_VERSION} with PyTorch into the app's data folder; your own Python is never used or changed.`,
        "",
        gpu
            ? `NVIDIA card found: ${gpu}. CUDA (for NVIDIA cards, about ${INSTALL_SIZE.cuda}) separates a track in under a minute; CPU (about ${INSTALL_SIZE.cpu}) takes about 10 minutes.`
            : `No NVIDIA card was found: CPU (about ${INSTALL_SIZE.cpu}) takes about 10 minutes per track. CUDA (about ${INSTALL_SIZE.cuda}) needs an NVIDIA card.`,
        status.installed ? `\nInstalled now: ${status.version} (${status.build}). Installing again replaces it.` : "",
    ].join("\n");
    const builds: StemDevice[] = gpu ? ["cuda", "cpu"] : ["cpu", "cuda"];
    const answer = await dialogBridge.confirm({
        title: "Install stem separation?",
        message: intro,
        choices: [
            { label: "Not now", tone: "primary" },
            ...builds.map((build) => ({
                label: `${build === "cuda" ? "CUDA" : "CPU"} · ${INSTALL_SIZE[build]}`,
                tone: "success" as const,
            })),
        ],
    });
    if (answer === null || answer === 0) return;
    const build = builds[answer - 1];
    try {
        await stemActivity.track("Installing stem separation", (onProgress) =>
            audioSeparatorEngine.install(build, { onProgress })
        );
        globalLogger.info(`Stem separation installed (${build})`);
        await dialogBridge.confirm({
            title: "Stem separation installed",
            message: `audio-separator ${AUDIO_SEPARATOR_VERSION} (${build}) is installed.\n\nNext: download a model (Settings → Stems → Download models…). ${DEFAULT_AUDIO_SEPARATOR_MODEL} (4 stems, 336 MB) is a good start.`,
            choices: [{ label: "OK", tone: "primary" }],
        });
    } catch (error) {
        globalLogger.error("Installing stem separation failed", { error });
        await tellFailure("Installing stem separation failed", error);
    }
}

export async function uninstallInteractively(): Promise<void> {
    const status = await audioSeparatorEngine.status();
    const size = formatSize((status.engineBytes ?? 0) + (status.modelBytes ?? 0));
    const answer = await dialogBridge.confirm({
        title: "Uninstall stem separation?",
        message: `This deletes audio-separator, its Python and every downloaded model (${size}).\n\nStems already separated or saved are not touched.`,
        choices: [
            { label: "Keep it", tone: "primary" },
            { label: "Uninstall", tone: "danger" },
        ],
    });
    if (answer !== 1) return;
    await audioSeparatorEngine.uninstall();
    globalLogger.info("Stem separation uninstalled");
}

/** Downloads one model, showing it as the engine's activity. Throws on failure. */
export async function downloadModel(model: Pick<StemModel, "id" | "label">): Promise<void> {
    await stemActivity.track(`Downloading ${model.label}`, (onProgress) =>
        audioSeparatorEngine.downloadModel(model.id, { onProgress })
    );
    globalLogger.info(`Stem model downloaded: ${model.id}`);
    const current = getStemProviderSettings(AUDIO_SEPARATOR_KEY).model;
    if (!current) saveProviderSetting({ model: model.id });
}

/** "Download models…": the list opens at once and fills when the engine has answered. */
export async function downloadModelsInteractively(): Promise<void> {
    let models: StemModel[] = [];
    const body = audioSeparatorEngine.listModels().then((list) => {
        models = sortModels(list);
        return {
            intro: "Pick a model to download. The recommended ones come first, then the other 4-stem models (vocals, drums, bass, other). Type to search.",
            items: models.map((model): ListItem => ({
                label: `${model.downloaded ? "✓ " : ""}${model.label}`,
                detail: describeModel(model),
            })),
            noneLabel: "Close",
        };
    });
    const answer = await dialogBridge.choose({
        title: "Download a stem model",
        items: [],
        body,
        loadingLabel: "Reading the model list…",
    });
    if (!answer || !("index" in answer)) return;
    const model = models[answer.index];
    if (!model) return;
    if (model.downloaded) {
        const remove = await dialogBridge.confirm({
            title: model.label,
            message: `Already downloaded (${formatSize(model.sizeBytes ?? 0)}).`,
            choices: [
                { label: "Keep it", tone: "primary" },
                { label: "Delete it", tone: "danger" },
            ],
        });
        if (remove === 1) await audioSeparatorEngine.removeModel(model.id);
        return;
    }
    try {
        await downloadModel(model);
    } catch (error) {
        globalLogger.error(`Downloading the stem model ${model.id} failed`, { error });
        await tellFailure("Download failed", error);
    }
}

/** "Default model…": only downloaded models are offered (a separation never downloads hundreds of MB unasked). */
export async function chooseDefaultModelInteractively(): Promise<void> {
    let models: StemModel[] = [];
    const body = audioSeparatorEngine.listModels().then((list) => {
        models = sortModels(list.filter((m) => m.downloaded));
        if (models.length === 0) {
            return {
                intro: "No model is downloaded yet: use “Download models…” first.",
                items: [],
                noneLabel: "Close",
            };
        }
        return {
            items: models.map((model): ListItem => ({ label: model.label, detail: describeModel(model) })),
            noneLabel: "Cancel",
        };
    });
    const answer = await dialogBridge.choose({
        title: "Default stem model",
        items: [],
        body,
        loadingLabel: "Reading the models…",
    });
    if (!answer || !("index" in answer)) return;
    const model = models[answer.index];
    if (model) saveProviderSetting({ model: model.id });
}

/** The rows under the provider's settings. Cheap: what is on disk comes from `status` (`audioSeparatorSettingsStatus`). */
export function audioSeparatorSettingsRows(
    stored: Record<string, boolean | string>,
    status: string | undefined
): ProviderSettingsRow[] {
    const installed = status !== undefined && status.startsWith("Installed");
    const rows: ProviderSettingsRow[] = [{ kind: "note", text: status ?? "Reading what is installed…" }];
    if (stored.enabled !== true) {
        rows.push({
            kind: "note",
            text: "Turn it on (and save) to install the engine. Nothing is downloaded until you ask.",
        });
        return rows;
    }
    rows.push({ kind: "action", icon: "⤓", label: installed ? "Reinstall…" : "Install…", run: installInteractively });
    if (installed) {
        const model = typeof stored.model === "string" && stored.model ? stored.model : DEFAULT_AUDIO_SEPARATOR_MODEL;
        rows.push(
            { kind: "action", icon: "⤓", label: "Download models…", run: downloadModelsInteractively },
            { kind: "action", icon: "›", label: `Default model: ${model}…`, run: chooseDefaultModelInteractively },
            { kind: "action", icon: "✕", label: "Uninstall…", run: uninstallInteractively }
        );
    }
    return rows;
}

/** What is installed, read in the background when the settings open. */
export async function audioSeparatorSettingsStatus(): Promise<string> {
    const status = await audioSeparatorEngine.status();
    if (!status.installed) {
        return status.modelBytes ? `Not installed (${formatSize(status.modelBytes)} of models kept)` : "Not installed";
    }
    let models = "";
    try {
        const downloaded = (await audioSeparatorEngine.listModels()).filter((m) => m.downloaded).length;
        models = ` · ${downloaded} model${downloaded === 1 ? "" : "s"} downloaded`;
    } catch {
        /* the list is read on first use */
    }
    return `Installed: audio-separator ${status.version} (${status.build}) · ${formatSize(status.engineBytes ?? 0)} + ${formatSize(status.modelBytes ?? 0)} of models${models}`;
}
