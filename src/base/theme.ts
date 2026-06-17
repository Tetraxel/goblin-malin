import darkTheme from "#assets/themes/dark.json";
import lightTheme from "#assets/themes/light.json";

export interface ThemePalette {
    blue: string;
    cyan: string;
    red: string;
    green: string;
    yellow: string;
    orange: string;
    purple: string;
    pink: string;
    white: string;
    grayLight: string;
    gray: string;
    grayDark: string;
}

export interface Theme {
    palette: ThemePalette;

    ui: {
        background: string;
        rowBackground: string;
        rowActiveDimmedBackground: string;
        rowActiveBackground: string;
        border: string;
        separator: string;
        selection: string;
        tabActive: string;
        tabInactive: string;
        panelTitle: string;
        progressFill: string;
        progressEmpty: string;
        modalBorder: string;
        focusIndicator: string;
        dimText: string;
    };

    text: {
        primary: string;
        secondary: string;
        muted: string;
        hint: string;
        active: string;
        heading: string;
    };

    status: {
        processing: string;
        pending: string;
        success: string;
        warning: string;
        error: string;
        skipped: string;
        locked: string;
        downloading: string;
    };

    field: {
        normal: string;
        overridden: string;
        missing: string;
        selected: string;
        error: string;
    };

    confidence: {
        primary: string;
        high: string;
        medium: string;
        low: string;
        veryLow: string;
    };

    diff: {
        base: string;
        changed: string;
        modified: string;
    };

    action: {
        primary: string;
        destructive: string;
        neutral: string;
    };
}

export const THEME_KEYS = ["dark", "light"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

const THEMES: Record<string, Theme> = {
    dark: darkTheme as Theme,
    light: lightTheme as Theme,
};

export function loadTheme(key: string): Theme {
    return THEMES[key] ?? THEMES["dark"];
}
