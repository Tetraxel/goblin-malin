import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { useFocusActions } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";

export const useSessionsButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    const { switchWindow } = useFocusActions();
    return {
        label: "Sessions",
        icon: "◈",
        color: theme.palette.purple,
        enabled: true,
        onPress: () => switchWindow("sessionsModal"),
    };
};
