import React, { createContext, useContext, useEffect, useState } from "react";
import { Theme, loadTheme } from "./theme";
import { SettingsStore } from "../settings/settingsStore";

export const ThemeContext = createContext<Theme>(loadTheme("dark"));

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState(() => loadTheme(SettingsStore.getInstance().getAppSettings().general.theme));
    useEffect(
        () =>
            SettingsStore.getInstance().onSettingsChanged(() => {
                setTheme(loadTheme(SettingsStore.getInstance().getAppSettings().general.theme));
            }),
        []
    );
    return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
    return useContext(ThemeContext);
}
