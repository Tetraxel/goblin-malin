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
        /**
         * Concurrency budgets. `maxParallelTasks` caps how many tasks the orchestrator
         * runs at once; the per-stage caps shape what those tasks may do simultaneously
         * — metadata fetches hit rate-limited APIs (keep low), downloads are IO-bound
         * (can scale higher). Raising `maxParallelTasks` + `maxParallelDownloads`
         * together is how download throughput scales without hammering metadata APIs.
         */
        concurrency: {
            maxParallelTasks: number;
            maxParallelMetadata: number;
            maxParallelDownloads: number;
        };
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
        concurrency: {
            // Defaults are >= the previous hardcoded cap of 3 everywhere, so no run
            // gets slower; raise these to scale parallelism up.
            maxParallelTasks: 4,
            maxParallelMetadata: 3,
            maxParallelDownloads: 4,
        },
    },
    logs: {
        logLevel: LogLevel.INFO,
        includeGlobalLogsInFocusedTask: false,
    },
    keybindings: {},
};
