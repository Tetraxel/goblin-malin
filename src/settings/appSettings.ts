import { PROJECT_ROOT } from "../constants";
import { Shortcut } from "#types/actions";

export type AppSettings = {
    general: {
        reopenLastSession: boolean;
        appDataDir: string;
        animationsEnabled: boolean;
        theme: string;
        showWelcomeTutorial: boolean;
    };
    /** User-remapped key bindings. Keys are shortcut action IDs, values override defaults. */
    keybindings: Record<string, Shortcut>;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    general: {
        reopenLastSession: false,
        appDataDir: PROJECT_ROOT,
        animationsEnabled: false,
        theme: "dark",
        showWelcomeTutorial: true,
    },
    keybindings: {},
};
