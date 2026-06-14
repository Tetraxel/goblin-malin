import { DEFAULT_APP_DATA_DIR } from "#constants";
import { Shortcut } from "#types/actions";

export type AppSettings = {
    general: {
        reopenLastSession: boolean;
        appDataDir: string;
        animationsEnabled: boolean;
        theme: string;
        showWelcomeTutorial: boolean;
        checkForUpdates: boolean;
    };
    /** User-remapped key bindings. Keys are shortcut action IDs, values override defaults. */
    keybindings: Record<string, Shortcut>;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    general: {
        reopenLastSession: false,
        appDataDir: DEFAULT_APP_DATA_DIR,
        animationsEnabled: false,
        theme: "dark",
        showWelcomeTutorial: true,
        checkForUpdates: true,
    },
    keybindings: {},
};
