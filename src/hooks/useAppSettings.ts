import { useEffect, useState } from "react";
import { SettingsStore } from "#settings/settingsStore";
import { AppSettings } from "#settings/appSettings";

/** Live-updating snapshot of the global app settings. */
export function useAppSettings(): AppSettings {
    const [settings, setSettings] = useState(() => SettingsStore.getInstance().getAppSettings());
    useEffect(
        () =>
            SettingsStore.getInstance().onSettingsChanged(() => {
                setSettings(SettingsStore.getInstance().getAppSettings());
            }),
        []
    );
    return settings;
}
