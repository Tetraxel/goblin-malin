import { Box, Text } from "ink";
import React from "react";
import { ToolbarButtonHook } from "./Toolbar";
import { FlowBase } from "../base/flow/flow-base";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";

export const ToolbarButtonInvoker = ({
  hook,
  isSelected,
  index,
  flow,
  orchestrator,
}: {
  hook: ToolbarButtonHook;
  isSelected: boolean;
  index: number;
  flow: FlowBase;
  orchestrator: FlowOrchestrator;
}) => {
  const { enabled, label, icon, color, bold, italic } = hook({
    isSelected,
    flow,
    orchestrator,
  });
  if (!enabled) return null;
  return (
    <Box
      key={index}
      paddingX={1}
      backgroundColor={isSelected ? color : undefined}
      overflow="hidden"
    >
      <Text
        color={isSelected ? "white" : color}
        bold={bold}
        italic={italic}
        wrap="truncate-end"
      >
        {`${icon} ${label}`}
      </Text>
    </Box>
  );
};
