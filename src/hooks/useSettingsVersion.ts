import { useEffect, useState } from "react";
import { SettingsStore } from "#settings/settingsStore";

/**
 * Bumps a counter on every settings change. Use it as a useMemo dependency to
 * re-derive values that read from the SettingsStore (e.g. task columns).
 */
export function useSettingsVersion(): number {
    const [version, setVersion] = useState(0);
    useEffect(() => SettingsStore.getInstance().onSettingsChanged(() => setVersion((v) => v + 1)), []);
    return version;
}
