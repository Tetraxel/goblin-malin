import { BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS, getMusicSettings, type StoredProviderSettings } from "../settings";
import { stemServiceRegistry } from "../registries";
import { type StemDevice, type StemEngine, type StemServiceConstructor } from "./stemService";

/** The stem settings, over their defaults (a settings file from before P33 has none). */
export function getStemSettings(): typeof BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS.stems {
    return { ...BASE_DEFAULT_MUSIC_DOWNLOAD_FLOW_SETTINGS.stems, ...getMusicSettings().stems };
}

/** The stored settings of one stem provider. */
export function getStemProviderSettings(key: string): StoredProviderSettings {
    return getStemSettings().providers?.[key] ?? {};
}

export function getStemServiceConstructor(key: string): StemServiceConstructor | undefined {
    return stemServiceRegistry.getConstructor(key) as StemServiceConstructor | undefined;
}

/** The engine of a stem provider (installing it, its models). */
export function getStemEngine(key: string): StemEngine | undefined {
    return getStemServiceConstructor(key)?.engine;
}

/** Every registered stem provider, in registration order. */
export function stemProviderKeys(): string[] {
    return [...stemServiceRegistry.getAllConstructors().keys()];
}

export function isStemProviderEnabled(key: string): boolean {
    const ctor = getStemServiceConstructor(key);
    const fallback = ctor?.defaultSettings?.enabled?.defaultValue ?? false;
    const stored = getStemProviderSettings(key).enabled;
    return typeof stored === "boolean" ? stored : fallback === true;
}

/** The provider a separation uses: the first enabled one. `undefined` while stem separation is off. */
export function activeStemProvider(): string | undefined {
    return stemProviderKeys().find(isStemProviderEnabled);
}

/** The model a provider separates with when nobody names one: the user's choice, else the class's default. */
export function defaultStemModel(key: string): string | undefined {
    const stored = getStemProviderSettings(key).model;
    if (typeof stored === "string" && stored.trim()) return stored.trim();
    return getStemServiceConstructor(key)?.defaultModel;
}

/**
 * The device a run asks for: the provider's `device` setting ("auto", "cuda", "cpu"); "auto" is what the engine was
 * installed for.
 */
export function resolveStemDevice(key: string, installedBuild: StemDevice | undefined): StemDevice {
    const setting = getStemProviderSettings(key).device;
    if (setting === "cuda" || setting === "cpu") return setting;
    return installedBuild ?? "cpu";
}

/** Why stems cannot be separated right now (feature off, not installed…), or `undefined` when they can. */
export async function stemUnavailableReason(): Promise<string | undefined> {
    const key = activeStemProvider();
    if (!key) return "Stem separation is off (Settings → Stems).";
    const engine = getStemEngine(key);
    if (!engine) return "The stem separation provider has no engine.";
    if (!(await engine.installedBuild()))
        return "The stem separation engine is not installed (Settings → Stems → Install).";
    return undefined;
}
