import React from "react";
import { Box, Text, useInput } from "ink";
import stringWidth from "string-width";
import { useFocusContext } from "../contexts/FocusContext";
import { FlowSelector } from "./FlowSelector";
import { Separator } from "./Separator";
import { FlowOrchestrator } from "../base/flow/flow-orchestrator";
import { ToolbarButtonInvoker } from "./ToolbarButtonInvoker";
import { FlowBase } from "../base/flow/flow-base";

export type ToolbarButtonHook<TFlow = FlowBase> = ({
  isSelected,
  flow,
  orchestrator,
}: {
  isSelected: boolean;
  flow: TFlow;
  orchestrator: FlowOrchestrator;
}) => {
  enabled: boolean;
  label?: string;
  icon?: string;
  color?: React.ComponentProps<typeof Text>["color"];
  bold?: boolean;
  italic?: boolean;
};

export const Toolbar = ({
  buttons,
  width,
  flows,
  onFlowChange,
  flow,
  orchestrator,
}: {
  buttons: ToolbarButtonHook[];
  width: number;
  flows: ReturnType<FlowOrchestrator["getAllFlows"]>;
  onFlowChange: (flowId: string) => void;
  flow: FlowBase;
  orchestrator: FlowOrchestrator;
}) => {
  const { focusState, ...focusManager } = useFocusContext();
  const isActive = focusState.activeWindow === "toolbar";
  const height = focusState.toolbar.height;

  useInput(
    (input, key) => {
      if (key.leftArrow) focusManager.moveToolbarSelection("left");
      if (key.rightArrow) focusManager.moveToolbarSelection("right");
      if (key.downArrow) focusManager.moveToolbarSelection("down");
    },
    { isActive },
  );

  const name = "🏷️+ ⭳✓ ☐ ☒ 😉 " + (width > 90 ? "Goblin Malin" : "");
  const nameWidth = stringWidth(name);
  const splitPositions = [nameWidth + 3]; // left border + padding

  return (
    <>
      <Separator width={width} type="top" splitPositions={splitPositions} />
      <Box
        borderStyle="single"
        borderColor="cyan"
        borderTop={false}
        borderBottom={false}
        paddingX={1}
        overflow="hidden"
        display={"flex"}
        height={height}
      >
        <Box
          borderStyle="single"
          borderColor="cyan"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          marginRight={1}
          width={nameWidth + 2}
          minWidth={nameWidth + 2}
          height={height}
          overflow="hidden"
        >
          <Text color={"yellow"} bold={true}>
            {name}
          </Text>
        </Box>

        {buttons.map((hook, index) => {
          const isSelected =
            isActive && focusState.toolbar.selectedButtonIndex === index;

          return (
            <ToolbarButtonInvoker
              key={index}
              hook={hook}
              isSelected={isSelected}
              index={index}
              flow={flow}
              orchestrator={orchestrator}
            />
          );
        })}

        {/* {buttons.map((hook, index) => {
          const isSelected =
            isActive && focusState.toolbar.selectedButtonIndex === index;
          const { enabled, label, icon, color, bold } = hook({ isSelected });

          if (!enabled) return null;

          return (
            <Box key={index} marginRight={0}>
              <Text
                backgroundColor={isSelected ? color : undefined}
                color={isSelected ? "white" : color}
                bold={bold}
              >
                {` ${icon} ${label} `}
              </Text>
            </Box>
          );
        })} */}

        <Box
          flexDirection={"row"}
          display={"flex"}
          flexGrow={1}
          justifyContent="flex-end"
          gap={1}
          height={height}
        >
          <FlowSelector
            flows={flows}
            currentFlow={flow}
            onFlowChange={onFlowChange}
          />
          {/* <Text color={"gray"} italic={true}>
            Music Download Flow
          </Text> */}
        </Box>
      </Box>
      <Separator
        width={width}
        splitPositions={splitPositions}
        splitCharacter={"┴"}
      />
    </>
  );
};
