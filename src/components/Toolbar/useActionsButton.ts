import { type ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { useFocusActions } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";

/** "Actions": opens the drop-down menu of things to do to the whole list (`ActionsMenu`). */
export const useActionsButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    const { switchWindow } = useFocusActions();
    return {
        label: "Actions",
        icon: "▾",
        color: theme.palette.orange,
        enabled: true,
        onPress: () => switchWindow("actionsMenu"),
    };
};
