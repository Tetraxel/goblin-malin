import { DeepPartial } from "#utils/types";
import { clearCache } from "#utils/cache";
import { THEME_KEYS } from "#base/theme";
import { LogLevel } from "#base/logger/types";
import { AppSettings } from "./appSettings";
import { SettingsItem } from "./buildSettingsItems";

const LOG_LEVELS: readonly string[] = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];

export function buildGlobalSettingsItems(
    settings: AppSettings,
    onChange: (patch: DeepPartial<AppSettings>) => void
): SettingsItem[] {
    return [
        {
            kind: "sectionHeader",
            label: "General",
        },
        {
            kind: "select",
            indent: 0,
            label: "Theme",
            options: THEME_KEYS,
            get: () => settings.general.theme,
            set: (v) => onChange({ general: { theme: v } }),
        },
        {
            kind: "checkbox",
            indent: 0,
            label: "Show welcome tutorial on start-up",
            get: () => settings.general.showWelcomeTutorial,
            set: (v) => onChange({ general: { showWelcomeTutorial: v } }),
        },
        {
            kind: "checkbox",
            indent: 0,
            label: "Check for updates on start-up",
            get: () => settings.general.checkForUpdates,
            set: (v) => onChange({ general: { checkForUpdates: v } }),
        },
        {
            kind: "checkbox",
            indent: 0,
            label: "Re-open last session on start-up",
            get: () => settings.general.reopenLastSession,
            set: (v) => onChange({ general: { reopenLastSession: v } }),
        },
        {
            kind: "checkbox",
            indent: 0,
            label: "Enable animations",
            get: () => settings.general.animationsEnabled,
            set: (v) => onChange({ general: { animationsEnabled: v } }),
        },
        {
            kind: "readonlyText",
            indent: 0,
            label: "🗁  App directory",
            value: settings.general.appDataDir,
        },
        {
            kind: "action",
            indent: 0,
            label: "⛒  Clear cache",
            run: () => clearCache(),
        },
        {
            kind: "sectionHeader",
            label: "Logs",
        },
        {
            kind: "select",
            indent: 0,
            label: "Minimum log level",
            options: LOG_LEVELS,
            get: () => settings.logs.logLevel,
            set: (v) => onChange({ logs: { logLevel: v as LogLevel } }),
        },
        {
            kind: "checkbox",
            indent: 0,
            label: "Include global logs when a task is focused",
            get: () => settings.logs.includeGlobalLogsInFocusedTask,
            set: (v) => onChange({ logs: { includeGlobalLogsInFocusedTask: v } }),
        },
    ];
}
