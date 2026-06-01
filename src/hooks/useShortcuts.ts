import { useEffect, useRef } from "react";
import { shortcutRegistry, ShortcutEntry, HintLineEntry, HintLineLeft } from "#base/shortcuts/ShortcutRegistry";
import { Shortcut } from "#types/actions";
import { SettingsStore } from "#settings/settingsStore";

export interface ShortcutDef {
    id: string;
    defaultShortcut: Shortcut;
    label: string;
    handler: () => void | Promise<void>;
}

export interface HintLineDef {
    id: string;
    left: HintLineLeft;
    shortcutIds: string[];
}

export interface UseShortcutsOptions {
    id: string;
    isActive: boolean;
    priority?: number;
    /**
     * When true, blocks lower-priority contexts while this one is active,
     * even when no shortcut matches the pressed key. Use for modals.
     */
    exclusive?: boolean;
    shortcuts: ShortcutDef[];
    hintLines?: HintLineDef[];
}

/**
 * Registers keyboard shortcuts with the central ShortcutRegistry.
 *
 * - Handlers fire only when `isActive` is true.
 * - Hint lines appear in DynamicHintBar only while `isActive` is true.
 * - User keybinding overrides from SettingsStore are applied transparently.
 * - Context is cleaned up automatically on unmount.
 */
export function useShortcuts({
    id,
    isActive,
    priority = 100,
    exclusive = false,
    shortcuts,
    hintLines = [],
}: UseShortcutsOptions): void {
    // Always-fresh ref so dispatch handlers never go stale.
    const shortcutsRef = useRef<ShortcutDef[]>(shortcuts);
    shortcutsRef.current = shortcuts; // eslint-disable-line react-hooks/refs

    // Build registry entries from a defs array. During render, pass `shortcuts` directly
    // so we never read shortcutsRef.current in the render body (satisfies react-hooks/refs).
    // Inside effects / event callbacks, pass shortcutsRef.current for up-to-date values.
    function buildEntries(defs: ShortcutDef[]): ShortcutEntry[] {
        const keybindings = SettingsStore.getInstance().getAppSettings().keybindings;
        return defs.map((def) => ({
            id: def.id,
            defaultShortcut: def.defaultShortcut,
            shortcut: keybindings[def.id] ?? def.defaultShortcut,
            label: def.label,
            // Handler is called outside render — reading the ref here is safe.
            handler: () => shortcutsRef.current.find((s) => s.id === def.id)?.handler(), // eslint-disable-line react-hooks/refs
        }));
    }

    function buildLines(): HintLineEntry[] {
        return hintLines.map((l) => ({ id: l.id, left: l.left, shortcutIds: l.shortcutIds }));
    }

    // Synchronous registration on first encounter — ensures DynamicHintBar sees
    // this context on the very first render (no one-frame flash of missing hints).
    if (!shortcutRegistry.hasContext(id)) {
        shortcutRegistry.register(id, buildEntries(shortcuts), buildLines(), isActive, priority, exclusive);
    } else {
        // Sync every render: keeps isActive, hint-line content, and keybindings fresh.
        shortcutRegistry.update(id, buildEntries(shortcuts), buildLines(), isActive);
    }

    // Unregister on unmount.
    useEffect(() => {
        return () => shortcutRegistry.unregister(id);
    }, [id]);

    // Re-sync keybindings whenever the user changes them in Settings.
    useEffect(() => {
        return SettingsStore.getInstance().onSettingsChanged(() => {
            // Reading the ref in an effect callback is fine — this runs outside render.
            shortcutRegistry.update(id, buildEntries(shortcutsRef.current), buildLines(), isActive);
        });
    }, [id, isActive]); // eslint-disable-line react-hooks/exhaustive-deps
}
