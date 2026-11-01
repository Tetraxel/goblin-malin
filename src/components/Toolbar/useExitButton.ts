import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { exitApp } from "#utils/exitApp";
import { useTheme } from "#base/themeContext";

export const useExitButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    return {
        label: "Exit",
        icon: "↳",
        color: theme.action.destructive,
        enabled: true,
        onPress: exitApp,
    };
};
