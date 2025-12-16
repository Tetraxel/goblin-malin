import { useEffect, useState } from 'react';
import { useInput } from 'ink';
import { ToolbarButtonHook } from '../../../components/Toolbar';
import { FlowBase } from '../../../base/flow/flow-base';
import { FlowOrchestrator } from '../../../base/flow/flow-orchestrator';


export const useImportButton: ToolbarButtonHook<FlowBase> = ({ isSelected, flow, orchestrator }: {
    isSelected: boolean,
    flow: FlowBase,
    orchestrator: FlowOrchestrator,
}) => {
    useInput(
        (input, key) => {
            if (key.return) {
                flow.importTasks();
            }
        },
        { isActive: isSelected }
    );

    return {
        label: "Import",
        icon: "⮯",
        color: "yellow",
        bold: false,
        enabled: true,
    };
}
