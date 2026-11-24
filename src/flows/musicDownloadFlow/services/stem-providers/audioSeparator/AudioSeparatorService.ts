import { type Logger } from "#base/logger/logger";
import { type ProviderDisplay } from "#base/providerDisplay";
import { type ProviderSettingsSchema } from "#base/providerSettings";
import { type SeparateRequest, type SeparatedStem, StemSeparationService } from "../../../stems/stemService";
import { type DownloadTask } from "../../../utils/downloadTask";
import { audioSeparatorEngine } from "./engine";
import {
    AUDIO_SEPARATOR_KEY,
    DEFAULT_AUDIO_SEPARATOR_MODEL,
    audioSeparatorSettingsRows,
    audioSeparatorSettingsStatus,
} from "./settingsRows";

/**
 * Stem separation with python-audio-separator (the engine of Ultimate Vocal Remover), run on this computer (P33).
 * Off by default: the engine (Python + PyTorch, about 3.7 GB with CUDA) and each model are only downloaded when the
 * user asks, in Settings → Stems.
 */
export class AudioSeparatorService extends StemSeparationService {
    static readonly display: ProviderDisplay = {
        label: "audio-separator",
        acronym: "UVR",
        color: "#e0a030",
        colorSubtle: "#6b4a10",
        colorBright: "#ffc04d",
    };
    static readonly summary =
        "Splits a track into stems (vocals, drums, bass, other) on this computer, with UVR's models.";
    static readonly defaultSettings: ProviderSettingsSchema = {
        enabled: { label: "Enable stem separation (audio-separator)", defaultValue: false, kind: "checkbox" },
        device: { label: "Run on", defaultValue: "auto", kind: "select", options: ["auto", "cuda", "cpu"] },
    };
    static readonly settingsRows = audioSeparatorSettingsRows;
    static readonly settingsStatus = audioSeparatorSettingsStatus;
    static readonly engine = audioSeparatorEngine;
    static readonly defaultModel = DEFAULT_AUDIO_SEPARATOR_MODEL;

    constructor(task: DownloadTask, logger: Logger) {
        super(AUDIO_SEPARATOR_KEY, task, logger);
    }

    separate(request: Omit<SeparateRequest, "logger">): Promise<SeparatedStem[]> {
        return audioSeparatorEngine.separate({ ...request, logger: this.logger });
    }
}
