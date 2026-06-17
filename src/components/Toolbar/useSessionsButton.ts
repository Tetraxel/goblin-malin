import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { useFocusContext } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";

export const useSessionsButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    const { switchWindow } = useFocusContext();
    return {
        label: "Sessions",
        icon: "◈",
        color: theme.palette.purple,
        enabled: true,
        onPress: () => switchWindow("sessionsModal"),
    };
};
