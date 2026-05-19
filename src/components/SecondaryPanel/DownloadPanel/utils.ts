import { providerDisplayRegistry } from "#base/providerDisplay";

export function getProviderColor(provider: string): string {
    return providerDisplayRegistry.get(provider).color;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | undefined): string {
    if (!ms) return "—";
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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
