import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { useFocusActions } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";

export const useSettingsButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    const { switchWindow } = useFocusActions();
    return {
        label: "Settings",
        icon: "⛭",
        color: theme.palette.grayLight,
        enabled: true,
        onPress: () => switchWindow("settingsModal"),
    };
};
