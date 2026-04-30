import { ToolbarButtonHook } from '../../../components/Toolbar';
import { FlowBase } from '../../../base/flow/flow-base';
import { useImportActions } from '../../../contexts/ImportActionsContext';

export const useImportButton: ToolbarButtonHook<FlowBase> = () => {
    const { openImportFlow } = useImportActions();
    return {
        label: "Import",
        icon: "⮯",
        color: "yellow",
        bold: false,
        enabled: true,
        onPress: () => openImportFlow(),
    };
};
