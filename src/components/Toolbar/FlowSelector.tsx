import React from "react";
import { Box, Text } from "ink";
import { FlowOrchestrator } from "../../base/flow/flow-orchestrator";
import { FlowBase } from "../../base/flow/flow-base";

export const FlowSelector: React.FC<{
  flows: ReturnType<FlowOrchestrator["getAllFlows"]>;
  currentFlow: FlowBase;
  onFlowChange: (flowId: string) => void;
}> = ({ flows, currentFlow }) => {
  return (
    <Box>
      {flows.map((flow) => (
        <Box key={flow.id} marginRight={2}>
          <Text
            color={flow.id === currentFlow.id ? "green" : "gray"}
            bold={flow.id === currentFlow.id}
          >
            {flow.displayName}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
