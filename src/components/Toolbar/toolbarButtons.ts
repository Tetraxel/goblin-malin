import { ToolbarButtonHook } from "./Toolbar";
import { useRunAllButton } from "#flows/musicDownloadFlow/toolbar/useRunAllButton";
import { useSessionsButton } from "./useSessionsButton";
import { useSettingsButton } from "./useSettingsButton";
import { useExitButton } from "./useExitButton";

// The toolbar's button list, as a module constant — the set is static for the
// app's life; each hook derives its own live state (labels, progress, colors).
export const TOOLBAR_BUTTONS: ToolbarButtonHook[] = [
    useRunAllButton,
    useSessionsButton,
    useSettingsButton,
    useExitButton,
];
