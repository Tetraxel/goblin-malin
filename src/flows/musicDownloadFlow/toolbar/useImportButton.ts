import { ToolbarButtonHook } from '../../../components/Toolbar';
import { FlowBase } from '../../../base/flow/flow-base';
import { useImportActions } from '../../../contexts/ImportActionsContext';
import { useTheme } from '../../../base/themeContext';

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
