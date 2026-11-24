import { useEffect, useState, useSyncExternalStore } from "react";
import { stemActivity } from "#flows/musicDownloadFlow/stems/stemActivity";
import {
    activeStemProvider,
    defaultStemModel,
    getStemEngine,
    resolveStemDevice,
} from "#flows/musicDownloadFlow/stems/stemProviders";
import { type StemEngineStatus, type StemModel } from "#flows/musicDownloadFlow/stems/stemService";
import { SettingsStore } from "#settings/settingsStore";

export type StemEngineInfo = {
    /** The provider separations use; undefined while stem separation is off. */
    provider?: string;
    status?: StemEngineStatus;
    /** The downloaded models (a separation only uses those). */
    models: StemModel[];
    defaultModel?: string;
    device?: string;
    /** Still reading (the model list starts Python: a few seconds the first time). */
    loading: boolean;
    error?: string;
};

/**
 * What the stem engine can do right now, for the Stems tab: read when the tab opens, and again when an install or a
 * model download ends, or the settings change. Never in render: the status walks the engine's folder.
 */
export function useStemEngineInfo(): StemEngineInfo {
    const activity = useSyncExternalStore(stemActivity.subscribe, stemActivity.get);
    const [settingsVersion, setSettingsVersion] = useState(0);
    const [info, setInfo] = useState<StemEngineInfo>({ models: [], loading: true });

    useEffect(() => SettingsStore.getInstance().onSettingsChanged(() => setSettingsVersion((v) => v + 1)), []);

    const busy = activity !== null;
    useEffect(() => {
        if (busy) return;
        let current = true;
        (async () => {
            const provider = activeStemProvider();
            const engine = provider ? getStemEngine(provider) : undefined;
            if (!provider || !engine) {
                setInfo({ models: [], loading: false });
                return;
            }
            const status = await engine.status();
            const base = {
                provider,
                status,
                defaultModel: defaultStemModel(provider),
                device: resolveStemDevice(provider, status.build),
            };
            if (!current) return;
            if (!status.installed) {
                setInfo({ ...base, models: [], loading: false });
                return;
            }
            setInfo((prev) => ({ ...prev, ...base, loading: true }));
            const models = (await engine.listModels()).filter((m) => m.downloaded);
            if (current) setInfo({ ...base, models, loading: false });
        })().catch((error: unknown) => {
            if (current) {
                setInfo((prev) => ({
                    ...prev,
                    loading: false,
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
        });
        return () => {
            current = false;
        };
    }, [busy, settingsVersion]);

    return info;
}
