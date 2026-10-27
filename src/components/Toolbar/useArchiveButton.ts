import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { useArchivedCount } from "#components/ArchiveModal/useArchive";
import { useFocusActions } from "#contexts/FocusContext";
import { useTheme } from "#base/themeContext";

export const useArchiveButton: ToolbarButtonHook = () => {
    const theme = useTheme();
    const { switchWindow } = useFocusActions();
    const count = useArchivedCount();
    return {
        label: count > 0 ? `Archive ${count}` : "Archive",
        icon: "▤",
        color: theme.palette.cyan,
        enabled: true,
        onPress: () => switchWindow("archiveModal"),
    };
};
