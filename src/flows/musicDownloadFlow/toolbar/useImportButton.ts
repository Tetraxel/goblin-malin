import { FlowBase } from "#base/flow/flow-base";
import { useTheme } from "#base/themeContext";
import { ToolbarButtonHook } from "#components/Toolbar/Toolbar";
import { useImportActions } from "#contexts/ImportActionsContext";

export const useImportButton: ToolbarButtonHook<FlowBase> = () => {
    const theme = useTheme();
    const { openImportFlow } = useImportActions();
    return {
        label: "Import",
        icon: "⮯",
        color: theme.action.primary,
        bold: false,
        enabled: true,
        onPress: () => openImportFlow(),
    };
};
