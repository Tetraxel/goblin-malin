import { ToolbarButtonHook } from "../../../components/Toolbar/Toolbar";
import { useFocusContext } from "../../../contexts/FocusContext";
import { useTheme } from "../../../base/themeContext";

export const useSettingsButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    const { switchWindow } = useFocusContext();
    return {
        label: "Settings",
        icon: "⛭",
        color: theme.action.neutral,
        enabled: true,
        onPress: () => switchWindow("settingsModal"),
    };
};
