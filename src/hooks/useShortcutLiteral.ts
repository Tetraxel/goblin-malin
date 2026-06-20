import { useReducer, useEffect } from "react";
import { shortcutRegistry } from "#base/shortcuts/ShortcutRegistry";
import { getShortcutLiteral } from "#types/actions";
import { SettingsStore } from "#settings/settingsStore";

/**
 * Resolves one or more registered shortcut ids to a display literal that reflects
 * the live keybinding config (user override ?? default), formatted via
 * `getShortcutLiteral`. Multiple ids are joined with "/" (e.g. "↓/Enter").
 *
 * Stays reactive: re-renders when the user remaps a binding in Settings or when
 * the registry's hint view changes — same subscription pattern as DynamicHintBar.
 */
export function useShortcutLiteral(idOrIds: string | string[]): string {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    useEffect(() => {
        const unsubRegistry = shortcutRegistry.subscribe(forceUpdate);
        const unsubSettings = SettingsStore.getInstance().onSettingsChanged(forceUpdate);
        return () => {
            unsubRegistry();
            unsubSettings();
        };
    }, []);

    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    if (ids.length === 0) return "";

    const keybindings = SettingsStore.getInstance().getAppSettings().keybindings;
    return ids
        .map((id) => {
            const resolved = keybindings[id] ?? shortcutRegistry.getDefaultShortcut(id);
            return resolved ? getShortcutLiteral([resolved]) : "";
        })
        .filter(Boolean)
        .join("/");
}
