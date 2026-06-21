import { DEFAULT_APP_DATA_DIR } from "#constants";
import { LogLevel } from "#base/logger/types";
import { Shortcut } from "#types/actions";

export type AppSettings = {
    general: {
        reopenLastSession: boolean;
        appDataDir: string;
        animationsEnabled: boolean;
        theme: string;
        showWelcomeTutorial: boolean;
        checkForUpdates: boolean;
        cacheEnabled: boolean;
    };
    logs: {
        /** Minimum level shown in the log panel (file transport always keeps debug). */
        logLevel: LogLevel;
        /** When a task is focused, also show logs not attributed to any task. */
        includeGlobalLogsInFocusedTask: boolean;
    };
    /** User-remapped key bindings. Keys are shortcut action IDs, values override defaults. */
    keybindings: Record<string, Shortcut>;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    general: {
        reopenLastSession: true,
        appDataDir: DEFAULT_APP_DATA_DIR,
        animationsEnabled: true,
        theme: "dark",
        showWelcomeTutorial: true,
        checkForUpdates: true,
        cacheEnabled: true,
    },
    logs: {
        logLevel: LogLevel.INFO,
        includeGlobalLogsInFocusedTask: false,
    },
    keybindings: {},
};
