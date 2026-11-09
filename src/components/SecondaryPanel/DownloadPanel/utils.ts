import { providerDisplayRegistry } from "#base/providerDisplay";
import type { SourceCandidate } from "#flows/musicDownloadFlow/types";

export function getProviderColor(provider: string): string {
    return providerDisplayRegistry.get(provider).color;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(d: Date): string {
    return d.toISOString().slice(0, 16).replace("T", " ");
}

export function tagValue(tags: Record<string, string | string[]> | undefined, key: string): string {
    if (!tags) return "—";
    const v = tags[key] ?? tags[key.toLowerCase()];
    if (!v) return "—";
    return Array.isArray(v) ? v.join(", ") : v;
}

/** "24/96" when the bit depth and sample rate are known, else "320k", else nothing. */
export function formatAnnouncedAudio(audio: SourceCandidate["audio"]): string {
    if (!audio) return "";
    if (audio.bitDepth && audio.sampleRateHz) {
        const khz = audio.sampleRateHz / 1000;
        return `${audio.bitDepth}/${Number.isInteger(khz) ? khz : khz.toFixed(1)}`;
    }
    return audio.bitrateKbps ? `${audio.bitrateKbps}k` : "";
}
