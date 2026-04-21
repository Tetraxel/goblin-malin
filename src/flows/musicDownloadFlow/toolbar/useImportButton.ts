import { ToolbarButtonHook } from '../../../components/Toolbar';
import { FlowBase } from '../../../base/flow/flow-base';
import { FlowOrchestrator } from '../../../base/flow/flow-orchestrator';

export const useImportButton: ToolbarButtonHook<FlowBase> = ({ flow }: {
    isSelected: boolean,
    flow: FlowBase,
    orchestrator: FlowOrchestrator,
}) => {
    return {
        label: "Import",
        icon: "⮯",
        color: "yellow",
        bold: false,
        enabled: true,
        onPress: () => flow.importTasks(),
    };
};
